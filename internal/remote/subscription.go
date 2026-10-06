// Package remote handles everything that talks to a network service:
// subscription fetching and the optional profile sync server.
package remote

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Requests carry the identity headers from settings: some panels gate the
// subscription endpoint on the User-Agent, and some count devices by x-hwid
// and refuse the request without it. See models/identity.go.

// RefreshSummary reports the outcome of a subscription refresh pass.
type RefreshSummary struct {
	Refreshed int `json:"refreshed"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
}

// Client performs subscription and sync requests.
type Client struct {
	http *http.Client
}

// NewClient returns a client with the timeouts the app expects.
func NewClient() *Client {
	return &Client{
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) get(
	ctx context.Context,
	rawURL string,
	settings models.AppSettings,
) (string, int, error) {
	body, status, _, err := c.getWithHeaders(ctx, rawURL, settings)
	return body, status, err
}

// getWithHeaders is get, also returning the response headers — where a
// subscription says how much data is left and when it expires.
func (c *Client) getWithHeaders(
	ctx context.Context,
	rawURL string,
	settings models.AppSettings,
) (string, int, http.Header, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", 0, nil, err
	}
	for name, value := range settings.SubscriptionHeaders() {
		request.Header.Set(name, value)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return "", 0, nil, err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return "", response.StatusCode, response.Header, err
	}
	return string(body), response.StatusCode, response.Header, nil
}

// ImportSubscription fetches a subscription and appends its profiles.
func (c *Client) ImportSubscription(
	ctx context.Context,
	profiles []models.Profile,
	settings models.AppSettings,
	rawURL string,
) ([]models.Profile, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid subscription URL")
	}
	sourceDomain := parsed.Hostname()

	body, status, headers, err := c.getWithHeaders(ctx, rawURL, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch subscription: %w", err)
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("subscription server returned %d: %s",
			status, explainStatus(status, settings, preview(body, 180)))
	}

	imported := buildProfiles(SubscriptionLinks(body), sourceDomain, rawURL)
	if len(imported) == 0 {
		return nil, emptySubscription(sourceDomain, body, headers, time.Now())
	}
	attachInfo(imported, ParseSubscriptionInfoWithBody(headers, body, time.Now()))
	return append(profiles, imported...), nil
}

// RefreshSubscriptions re-fetches saved subscriptions and replaces their
// profiles. Passing a domain restricts the refresh to that source and turns
// failures into hard errors so the UI can explain what went wrong.
func (c *Client) RefreshSubscriptions(
	ctx context.Context,
	profiles []models.Profile,
	settings models.AppSettings,
	onlyDomain string,
) ([]models.Profile, RefreshSummary, error) {
	summary := RefreshSummary{}
	sources := collectSubscriptionSources(profiles)
	strict := strings.TrimSpace(onlyDomain) != ""

	if strict {
		domain := strings.TrimSpace(onlyDomain)
		if domain == "local" {
			return profiles, summary, fmt.Errorf("invalid subscription domain")
		}
		subURL, ok := sources[domain]
		if !ok {
			return profiles, summary, fmt.Errorf(
				"subscription URL not found for domain %q; re-import this subscription once, then refresh will work",
				domain)
		}
		sources = map[string]string{domain: subURL}
	}
	if len(sources) == 0 {
		return profiles, summary, nil
	}

	result := profiles
	for sourceDomain, subURL := range sources {
		parsed, err := url.Parse(subURL)
		if err != nil || parsed.Hostname() == "" {
			if strict {
				return profiles, summary, fmt.Errorf(
					"saved subscription URL is invalid for %q", sourceDomain)
			}
			summary.Skipped++
			continue
		}
		if parsed.Hostname() != sourceDomain {
			if strict {
				return profiles, summary, fmt.Errorf(
					"saved subscription URL host %q does not match source %q",
					parsed.Hostname(), sourceDomain)
			}
			summary.Skipped++
			continue
		}

		body, status, headers, err := c.getWithHeaders(ctx, subURL, settings)
		if err != nil {
			if strict {
				return profiles, summary, fmt.Errorf(
					"failed to request subscription %q: %w", sourceDomain, err)
			}
			summary.Failed++
			continue
		}
		if status < 200 || status >= 300 {
			if strict {
				return profiles, summary, fmt.Errorf(
					"subscription server %q returned %d: %s",
					sourceDomain, status, explainStatus(status, settings, preview(body, 180)))
			}
			summary.Failed++
			continue
		}

		fresh := buildProfiles(SubscriptionLinks(body), sourceDomain, subURL)
		if len(fresh) == 0 {
			if strict {
				return profiles, summary, emptySubscription(sourceDomain, body, headers, time.Now())
			}
			summary.Failed++
			continue
		}

		filtered := make([]models.Profile, 0, len(result)+len(fresh))
		var previous []models.Profile
		for _, profile := range result {
			if strings.TrimSpace(profile.SourceDomain) != sourceDomain {
				filtered = append(filtered, profile)
			} else {
				previous = append(previous, profile)
			}
		}
		attachInfo(fresh, ParseSubscriptionInfoWithBody(headers, body, time.Now()))
		result = append(filtered, KeepIdentities(previous, fresh)...)
		summary.Refreshed++
	}

	if strict && summary.Refreshed == 0 {
		return profiles, summary, fmt.Errorf("subscription refresh finished, but no profiles were updated")
	}
	return result, summary, nil
}

// SubscriptionLinks decodes a subscription body and returns the usable links.
func SubscriptionLinks(raw string) []string {
	decoded := decodeSubscriptionBody(raw)

	var links []string
	for _, line := range strings.Split(decoded, "\n") {
		candidate := strings.TrimSpace(line)
		if candidate == "" || strings.HasPrefix(candidate, "#") {
			continue
		}
		// Provider bookkeeping entries and placeholder nodes.
		if strings.Contains(candidate, ".time:") || strings.Contains(candidate, "fake_ip") {
			continue
		}
		if isPlaceholder(candidate) {
			continue
		}
		links = append(links, strings.ReplaceAll(candidate, "&amp;", "&"))
	}
	return links
}

// decodeSubscriptionBody unwraps the base64 envelope most providers use,
// falling back to the raw text when it is already a link list.
func decodeSubscriptionBody(raw string) string {
	trimmed := strings.TrimSpace(raw)
	compact := strings.NewReplacer("\n", "", "\r", "").Replace(trimmed)
	if decoded, err := link.DecodeBase64(compact); err == nil {
		return string(decoded)
	}
	return trimmed
}

// KeepIdentities gives refreshed profiles the ids and usage totals of the
// ones they replace.
//
// A refresh used to mint new ids for every server, and the app refreshes on
// every start — so anything that refers to a profile by id lost it on
// restart: the selected server fell back to automatic, proxy-chain hops
// pointed at nothing, and traffic totals reset. A server is matched by its
// link first, which is exact, and then by name, which survives a provider
// rotating credentials or ports under the same entry.
func KeepIdentities(previous, fresh []models.Profile) []models.Profile {
	byLink := map[string]models.Profile{}
	byName := map[string]models.Profile{}
	for _, profile := range previous {
		byLink[strings.TrimSpace(profile.ConfigLink)] = profile
		byName[strings.TrimSpace(profile.Name)] = profile
	}

	taken := map[string]bool{}
	match := func(index map[string]models.Profile, key string) (models.Profile, bool) {
		old, found := index[strings.TrimSpace(key)]
		if !found || taken[old.ID] {
			return models.Profile{}, false
		}
		taken[old.ID] = true
		return old, true
	}

	kept := make([]models.Profile, len(fresh))
	for i, profile := range fresh {
		old, found := match(byLink, profile.ConfigLink)
		if !found {
			old, found = match(byName, profile.Name)
		}
		if found {
			profile.ID = old.ID
			profile.TotalUp = old.TotalUp
			profile.TotalDown = old.TotalDown
			profile.Favorite = old.Favorite
			// A response without the header says nothing new; keep what
			// the last one said rather than forgetting it.
			if profile.SubscriptionInfo == nil {
				profile.SubscriptionInfo = old.SubscriptionInfo
			}
		}
		kept[i] = profile
	}
	return kept
}

func buildProfiles(links []string, sourceDomain, subURL string) []models.Profile {
	profiles := make([]models.Profile, 0, len(links))
	for _, rawLink := range links {
		protocol := link.DetectProtocol(rawLink)
		if protocol == "unknown" {
			continue
		}
		zero := uint64(0)
		profiles = append(profiles, models.Profile{
			ID:              uuid.NewString(),
			Name:            link.ExtractName(rawLink),
			Server:          "Auto",
			Protocol:        protocol,
			ConfigLink:      rawLink,
			SourceDomain:    sourceDomain,
			SubscriptionURL: subURL,
			TotalUp:         &zero,
			TotalDown:       &zero,
		})
	}
	return profiles
}

// collectSubscriptionSources maps each source domain to the URL it came from,
// falling back to profiles that stored the subscription URL as their link.
func collectSubscriptionSources(profiles []models.Profile) map[string]string {
	sources := map[string]string{}
	legacy := map[string]string{}

	for _, profile := range profiles {
		source := strings.TrimSpace(profile.SourceDomain)
		if source == "" || source == "local" {
			continue
		}

		subURL := strings.TrimSpace(profile.SubscriptionURL)
		if subURL == "" {
			if parsed, err := url.Parse(strings.TrimSpace(profile.ConfigLink)); err == nil {
				if parsed.Scheme == "http" || parsed.Scheme == "https" {
					if _, exists := legacy[source]; !exists {
						legacy[source] = strings.TrimSpace(profile.ConfigLink)
					}
				}
			}
			continue
		}
		if _, exists := sources[source]; !exists {
			sources[source] = subURL
		}
	}

	for source, subURL := range legacy {
		if _, exists := sources[source]; !exists {
			sources[source] = subURL
		}
	}
	return sources
}

func preview(body string, limit int) string {
	compact := []rune(strings.Join(strings.Fields(body), " "))
	if len(compact) <= limit {
		return string(compact)
	}
	return string(compact[:limit]) + "…"
}

// explainStatus adds a hint to the statuses that a device-limited panel
// produces, because on their own they look like a broken subscription.
//
// Remnawave answers 404 when its device limit is on and the request carried no
// x-hwid, which is indistinguishable from a wrong URL; 403 is the usual answer
// when a provider does not recognise the client. Neither says what to change.
func explainStatus(status int, settings models.AppSettings, body string) string {
	switch status {
	case 404:
		if !settings.HWIDOn() {
			return body + " — if this subscription enforces a device limit, " +
				"turn on the device id in Settings and try again"
		}
	case 403:
		return body + " — this provider may only accept known clients; " +
			"try a different subscription user agent in Settings"
	}
	return body
}

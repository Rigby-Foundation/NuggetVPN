// Package remote handles everything that talks to a network service:
// subscription fetching and the optional profile sync server.
package remote

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
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

// A source is identified by its full URL, including the path and query.
type subscriptionSource struct {
	domain, url string
}

// Replacement is the result of a fetch, applied to the current profiles
// after the network request finishes.
type Replacement struct {
	source  subscriptionSource
	fresh   []models.Profile
	refresh bool
}

// FetchSubscription retrieves the servers at a subscription URL.
func (c *Client) FetchSubscription(ctx context.Context, settings models.AppSettings, rawURL string) (Replacement, error) {
	rawURL = strings.TrimSpace(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" || parsed.Scheme != "http" && parsed.Scheme != "https" {
		return Replacement{}, fmt.Errorf("invalid subscription URL")
	}
	source := subscriptionSource{domain: parsed.Hostname(), url: rawURL}
	return c.fetchSubscription(ctx, settings, source)
}

func (c *Client) fetchSubscription(ctx context.Context, settings models.AppSettings, source subscriptionSource) (Replacement, error) {
	body, status, headers, err := c.getWithHeaders(ctx, source.url, settings)
	if err != nil {
		return Replacement{}, fmt.Errorf("failed to fetch subscription: %w", err)
	}
	if status < 200 || status >= 300 {
		return Replacement{}, fmt.Errorf("subscription server returned %d: %s",
			status, explainStatus(status, settings, preview(body, 180)))
	}

	fresh := buildProfiles(subscriptionEntries(body), source.domain, source.url)
	if len(fresh) == 0 {
		return Replacement{}, emptySubscription(source.domain, body, headers, time.Now())
	}
	attachInfo(fresh, ParseSubscriptionInfoWithBody(headers, body, time.Now()))
	return Replacement{source: source, fresh: fresh}, nil
}

// FetchSubscriptions re-fetches each saved subscription URL. Passing a domain
// restricts the scan to that host and reports errors to the caller.
func (c *Client) FetchSubscriptions(
	ctx context.Context,
	profiles []models.Profile,
	settings models.AppSettings,
	onlyDomain string,
) ([]Replacement, RefreshSummary, error) {
	summary := RefreshSummary{}
	domain := strings.TrimSpace(onlyDomain)
	var replacements []Replacement
	found := false

	for _, source := range collectSubscriptionSources(profiles) {
		if domain != "" && domain != source.domain {
			continue
		}
		found = true
		parsed, err := url.Parse(source.url)
		if err != nil || parsed.Hostname() != source.domain || parsed.Scheme != "http" && parsed.Scheme != "https" {
			if domain != "" {
				return nil, summary, fmt.Errorf("saved subscription URL is invalid for %q", domain)
			}
			summary.Skipped++
			continue
		}

		replacement, err := c.fetchSubscription(ctx, settings, source)
		if err != nil {
			if domain != "" {
				return nil, summary, err
			}
			summary.Failed++
			continue
		}
		replacement.refresh = true
		replacements = append(replacements, replacement)
		summary.Refreshed++
	}

	if domain != "" && !found {
		return nil, summary, fmt.Errorf(
			"subscription URL not found for domain %q; re-import this subscription once, then refresh will work", domain)
	}
	return replacements, summary, nil
}

// Apply merges fetched servers into the latest profiles, preserving changes
// made while the request ran, such as adding a profile or starring a server.
func Apply(current []models.Profile, replacements []Replacement) []models.Profile {
	for _, replacement := range replacements {
		updated := make([]models.Profile, 0, len(current)+len(replacement.fresh))
		var previous []models.Profile
		insertAt := -1
		for _, profile := range current {
			if !replacement.source.matches(profile) {
				updated = append(updated, profile)
				continue
			}
			if insertAt < 0 {
				insertAt = len(updated)
			}
			previous = append(previous, profile)
		}
		if insertAt < 0 {
			if replacement.refresh {
				// The subscription was removed or its URL changed during the fetch.
				continue
			}
			insertAt = len(updated)
		}
		current = slices.Insert(updated, insertAt, KeepIdentities(previous, replacement.fresh)...)
	}
	return current
}

// SubscriptionLinks decodes a subscription body and returns the usable links.
func SubscriptionLinks(raw string) []string {
	entries := subscriptionEntries(raw)
	links := make([]string, len(entries))
	for index, entry := range entries {
		links[index] = entry.link
	}
	return links
}

// subscriptionEntry is a usable link and the section it is listed under.
type subscriptionEntry struct {
	link, group string
}

// subscriptionEntries decodes a subscription body into its usable links,
// each with the section a separator before it opened. A separator is a
// placeholder entry (see isPlaceholder) that marks itself as one: Remnawave
// describes it so, or its name is drawn as a divider ("⬇️ — WiFi — ⬇️").
// Other placeholders are messages and only skipped.
func subscriptionEntries(raw string) []subscriptionEntry {
	decoded := decodeSubscriptionBody(raw)
	// Whole Xray configs, as panels send Happ 4: read as their links.
	if links, ok := link.XrayConfigsAsLinks(decoded); ok {
		decoded = links
	} else if links, ok := link.ClashProxiesAsLinks(decoded); ok {
		decoded = links
	}

	var entries []subscriptionEntry
	group := ""
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
			if name, ok := separatorName(candidate); ok {
				group = name
			}
			continue
		}
		entries = append(entries, subscriptionEntry{link: strings.ReplaceAll(candidate, "&amp;", "&"), group: group})
	}
	return entries
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

func buildProfiles(entries []subscriptionEntry, sourceDomain, subURL string) []models.Profile {
	profiles := make([]models.Profile, 0, len(entries))
	for _, entry := range entries {
		rawLink := entry.link
		protocol := link.DetectProtocol(rawLink)
		if protocol == "unknown" || protocol == "sing-box" || protocol == "clash-yaml" {
			continue
		}
		zero := uint64(0)
		profiles = append(profiles, models.Profile{
			ID:              uuid.NewString(),
			Name:            link.ExtractName(rawLink),
			Description:     link.ExtractDescription(rawLink),
			Server:          "Auto",
			Protocol:        protocol,
			ConfigLink:      rawLink,
			SourceDomain:    sourceDomain,
			SubscriptionURL: subURL,
			TotalUp:         &zero,
			TotalDown:       &zero,
			Group:           entry.group,
		})
	}
	return profiles
}

// collectSubscriptionSources keeps all URLs on a host. Older profiles can
// store the subscription URL in ConfigLink instead of SubscriptionURL.
func collectSubscriptionSources(profiles []models.Profile) []subscriptionSource {
	var sources, legacy []subscriptionSource
	hasExplicitURL := map[string]bool{}
	seen := map[subscriptionSource]bool{}
	for _, profile := range profiles {
		domain := strings.TrimSpace(profile.SourceDomain)
		if domain == "" || domain == "local" {
			continue
		}
		if rawURL := strings.TrimSpace(profile.SubscriptionURL); rawURL != "" {
			hasExplicitURL[domain] = true
			source := subscriptionSource{domain: domain, url: rawURL}
			if !seen[source] {
				sources = append(sources, source)
				seen[source] = true
			}
		} else if rawURL := legacySubscriptionURL(profile); rawURL != "" {
			legacy = append(legacy, subscriptionSource{domain: domain, url: rawURL})
		}
	}
	for _, source := range legacy {
		if !hasExplicitURL[source.domain] && !seen[source] {
			sources = append(sources, source)
			seen[source] = true
		}
	}
	return sources
}

func (source subscriptionSource) matches(profile models.Profile) bool {
	if strings.TrimSpace(profile.SourceDomain) != source.domain {
		return false
	}
	if rawURL := strings.TrimSpace(profile.SubscriptionURL); rawURL != "" {
		return rawURL == source.url
	}
	return legacySubscriptionURL(profile) == source.url
}

func legacySubscriptionURL(profile models.Profile) string {
	rawURL := strings.TrimSpace(profile.ConfigLink)
	parsed, err := url.Parse(rawURL)
	if err == nil && parsed.Hostname() == strings.TrimSpace(profile.SourceDomain) &&
		(parsed.Scheme == "http" || parsed.Scheme == "https") {
		return rawURL
	}
	return ""
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

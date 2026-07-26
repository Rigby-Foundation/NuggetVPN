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

// subscriptionUserAgent mimics curl; several providers reject unknown clients.
const subscriptionUserAgent = "curl/8.7.1 NuggetVPN/1.0"

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

func (c *Client) get(ctx context.Context, rawURL string) (string, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", 0, err
	}
	request.Header.Set("User-Agent", subscriptionUserAgent)

	response, err := c.http.Do(request)
	if err != nil {
		return "", 0, err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return "", response.StatusCode, err
	}
	return string(body), response.StatusCode, nil
}

// ImportSubscription fetches a subscription and appends its profiles.
func (c *Client) ImportSubscription(
	ctx context.Context,
	profiles []models.Profile,
	rawURL string,
) ([]models.Profile, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("invalid subscription URL")
	}
	sourceDomain := parsed.Hostname()

	body, status, err := c.get(ctx, rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch subscription: %w", err)
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("subscription server returned %d: %s", status, preview(body, 180))
	}

	imported := buildProfiles(SubscriptionLinks(body), sourceDomain, rawURL)
	if len(imported) == 0 {
		return nil, fmt.Errorf("no supported profiles found in subscription")
	}
	return append(profiles, imported...), nil
}

// RefreshSubscriptions re-fetches saved subscriptions and replaces their
// profiles. Passing a domain restricts the refresh to that source and turns
// failures into hard errors so the UI can explain what went wrong.
func (c *Client) RefreshSubscriptions(
	ctx context.Context,
	profiles []models.Profile,
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

		body, status, err := c.get(ctx, subURL)
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
					"subscription server %q returned %d: %s", sourceDomain, status, preview(body, 180))
			}
			summary.Failed++
			continue
		}

		fresh := buildProfiles(SubscriptionLinks(body), sourceDomain, subURL)
		if len(fresh) == 0 {
			if strict {
				return profiles, summary, fmt.Errorf(
					"subscription %q returned no supported links. Response preview: %s",
					sourceDomain, preview(body, 220))
			}
			summary.Failed++
			continue
		}

		filtered := make([]models.Profile, 0, len(result)+len(fresh))
		for _, profile := range result {
			if strings.TrimSpace(profile.SourceDomain) != sourceDomain {
				filtered = append(filtered, profile)
			}
		}
		result = append(filtered, fresh...)
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
		if strings.Contains(candidate, "@127.0.0.1:") ||
			strings.Contains(candidate, "00000000-0000-0000-0000-000000000000") {
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
	compact := strings.Join(strings.Fields(body), " ")
	if len(compact) <= limit {
		return compact
	}
	return compact[:limit]
}

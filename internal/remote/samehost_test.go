package remote

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

// Two subscriptions from one panel share a host, and so a source domain.
// Refreshing must update each from its own URL, not replace both with one.
func TestRefreshKeepsSubscriptionsOnOneHostApart(t *testing.T) {
	var expanded atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sub/alice":
			fmt.Fprint(w, "vless://a@1.1.1.1:443#Alice-1\nvless://a@1.1.1.2:443#Alice-2")
		case "/sub/bob":
			fmt.Fprint(w, "vless://b@2.2.2.1:443#Bob-1")
			if expanded.Load() {
				fmt.Fprint(w, "\nvless://b@2.2.2.2:443#Bob-2")
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient()
	settings := models.DefaultSettings()
	ctx := context.Background()

	var profiles []models.Profile
	// Importing one again updates it rather than listing it twice.
	for _, path := range []string{"/sub/alice", "/sub/bob", "/sub/bob"} {
		replacement, err := client.FetchSubscription(ctx, settings, server.URL+path)
		if err != nil {
			t.Fatal(err)
		}
		profiles = Apply(profiles, []Replacement{replacement})
	}
	if len(profiles) != 3 {
		t.Fatalf("after importing bob twice: %d profiles, want 3", len(profiles))
	}

	expanded.Store(true)
	replacements, summary, err := client.FetchSubscriptions(ctx, profiles, settings, "")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Refreshed != 2 {
		t.Errorf("refreshed %d subscriptions, want 2", summary.Refreshed)
	}
	refreshed := Apply(profiles, replacements)
	names := map[string]bool{}
	for _, profile := range refreshed {
		names[profile.Name] = true
	}
	for _, want := range []string{"Alice-1", "Alice-2", "Bob-1", "Bob-2"} {
		if !names[want] {
			t.Errorf("%s is missing after refresh: %v", want, names)
		}
	}
	if len(refreshed) != 4 {
		t.Errorf("%d profiles after refresh, want 4", len(refreshed))
	}
}

// A refresh fetched from a snapshot is applied to the list as it is by the
// time it returns, so what changed meanwhile stays.
func TestApplyKeepsChangesMadeDuringTheFetch(t *testing.T) {
	snapshot := []models.Profile{
		{ID: "s1", Name: "One", SourceDomain: "example.com", SubscriptionURL: "https://example.com/s", ConfigLink: "vless://a@1.1.1.1:443#One"},
	}
	replacement := Replacement{
		source:  subscriptionSource{domain: "example.com", url: "https://example.com/s"},
		refresh: true,
		fresh:   []models.Profile{{ID: "new", Name: "One", SourceDomain: "example.com", SubscriptionURL: "https://example.com/s", ConfigLink: "vless://a@1.1.1.1:443#One"}},
	}
	// Meanwhile: a server added by hand, and the subscription's one starred.
	current := append([]models.Profile{}, snapshot...)
	current[0].Favorite = true
	current = append(current, models.Profile{ID: "hand", Name: "Mine", SourceDomain: "local"})

	result := Apply(current, []Replacement{replacement})
	if len(result) != 2 {
		t.Fatalf("%d profiles, want 2", len(result))
	}
	if result[0].ID != "s1" || !result[0].Favorite || result[1].ID != "hand" {
		t.Errorf("changes made during the fetch were lost: %+v", result)
	}
	if result := Apply(current[1:], []Replacement{replacement}); len(result) != 1 || result[0].ID != "hand" {
		t.Errorf("refresh brought back a subscription deleted during the fetch: %+v", result)
	}
}

// A provider cannot slip a complete config, which would run as it is, into
// a server list.
func TestSubscriptionsSkipCompleteConfigs(t *testing.T) {
	entries := subscriptionEntries(`vless://a@1.1.1.1:443#Fine
{"log":{"output":"/etc/x"},"inbounds":[{"type":"mixed","listen":"0.0.0.0","listen_port":1080}],"outbounds":[{"type":"direct"}]}`)
	profiles := buildProfiles(entries, "example.com", "https://example.com/s")
	if len(profiles) != 1 || profiles[0].Name != "Fine" {
		t.Errorf("profiles = %+v", profiles)
	}
}

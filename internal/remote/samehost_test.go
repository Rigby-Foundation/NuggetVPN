package remote

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Two subscriptions from one panel share a host, and so a source domain.
// Refreshing must update each from its own URL, not replace both with one.
func TestRefreshKeepsSubscriptionsOnOneHostApart(t *testing.T) {
	servers := map[string]string{
		"/sub/alice": "vless://a@1.1.1.1:443#Alice-1\nvless://a@1.1.1.2:443#Alice-2",
		"/sub/bob":   "vless://b@2.2.2.1:443#Bob-1",
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, servers[r.URL.Path])
	}))
	defer server.Close()

	client := NewClient()
	settings := models.DefaultSettings()
	ctx := context.Background()

	var profiles []models.Profile
	for _, path := range []string{"/sub/alice", "/sub/bob"} {
		var err error
		profiles, err = client.ImportSubscription(ctx, profiles, settings, server.URL+path)
		if err != nil {
			t.Fatal(err)
		}
	}
	// Importing one again updates it rather than listing it twice.
	profiles, err := client.ImportSubscription(ctx, profiles, settings, server.URL+"/sub/bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 3 {
		t.Fatalf("after importing bob twice: %d profiles, want 3", len(profiles))
	}

	servers["/sub/bob"] = "vless://b@2.2.2.1:443#Bob-1\nvless://b@2.2.2.2:443#Bob-2"
	refreshed, summary, err := client.RefreshSubscriptions(ctx, profiles, settings, "")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Refreshed != 2 {
		t.Errorf("refreshed %d subscriptions, want 2", summary.Refreshed)
	}
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
		Domain: "example.com", URL: "https://example.com/s", Whole: true,
		Fresh: []models.Profile{{ID: "new", Name: "One", SourceDomain: "example.com", ConfigLink: "vless://a@1.1.1.1:443#One"}},
	}
	// Meanwhile: a server added by hand, and the subscription's one starred.
	current := append([]models.Profile{}, snapshot...)
	current[0].Favorite = true
	current = append(current, models.Profile{ID: "hand", Name: "Mine", SourceDomain: "local"})

	result := Apply(current, []Replacement{replacement})
	if len(result) != 2 {
		t.Fatalf("%d profiles, want 2", len(result))
	}
	for _, profile := range result {
		if profile.ID == "s1" && !profile.Favorite {
			t.Error("the star set during the fetch was lost")
		}
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

package sbconfig

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	sbjson "github.com/sagernet/sing/common/json"

	officialbox "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official"
	officialinclude "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/include"
	officialoption "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
)

// resolvedRequest is the feature request with every server name looked up
// in advance, as the app does before starting the core.
func resolvedRequest(t *testing.T) (Request, *[]string) {
	request := featureRequest(t)
	var asked []string
	request.Resolve = func(domains []string) map[string][]string {
		asked = append(asked, domains...)
		answers := map[string][]string{}
		for _, domain := range domains {
			// An IPv6 answer and garbage are dropped; the IPv4 one is kept.
			answers[domain] = []string{"2001:db8::1", "not an address", "203.0.113.7"}
		}
		return answers
	}
	return request, &asked
}

func TestResolvedServersAnswerFromTheAppsLookup(t *testing.T) {
	request, asked := resolvedRequest(t)
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(*asked) == 0 {
		t.Fatal("Resolve was never asked about the servers")
	}
	var config struct {
		DNS struct {
			Servers []map[string]any `json:"servers"`
			Rules   []map[string]any `json:"rules"`
		} `json:"dns"`
		Outbounds []map[string]any `json:"outbounds"`
		Route     struct {
			Rules []map[string]any `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatal(err)
	}

	var hosts map[string]any
	for _, server := range config.DNS.Servers {
		if server["tag"] == dnsServersTag {
			hosts = server
		}
	}
	if hosts == nil || hosts["type"] != "hosts" {
		t.Fatalf("no hosts server for the servers' names: %v", config.DNS.Servers)
	}
	for _, domain := range *asked {
		got, _ := json.Marshal(hosts["predefined"].(map[string]any)[domain])
		if string(got) != `["203.0.113.7"]` {
			t.Errorf("%s answers %s, want only the IPv4 address", domain, got)
		}
	}

	dialing := 0
	for _, outbound := range config.Outbounds {
		if server, _ := outbound["server"].(string); server != "" && !strings.Contains(server, ":") {
			if outbound["domain_resolver"] != dnsServersTag {
				t.Errorf("outbound %v dials %s without the app's lookup", outbound["tag"], server)
			}
			dialing++
		}
	}
	if dialing == 0 {
		t.Fatal("no outbound dials a server by name; the test proves nothing")
	}

	resolves := false
	for _, rule := range config.Route.Rules {
		if rule["action"] == "resolve" && rule["server"] == dnsServersTag {
			resolves = true
		}
	}
	if !resolves {
		t.Error("direct connections to a server by name do not resolve it from the app's lookup")
	}

	// Both cores have to take it.
	construct(t, result.JSON)
	constructOfficial(t, result.JSON)
}

// A name the lookup had nothing for keeps going to settings.DNS directly.
func TestUnresolvedServersKeepTheDirectResolver(t *testing.T) {
	request := featureRequest(t)
	request.Resolve = func([]string) map[string][]string { return nil }
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(result.JSON), dnsServersTag) {
		t.Fatalf("a config with nothing looked up still mentions %s", dnsServersTag)
	}
	construct(t, result.JSON)
}

func constructOfficial(t *testing.T, configJSON []byte) {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal(configJSON, &raw); err != nil {
		t.Fatal(err)
	}
	delete(raw, "inbounds")
	delete(raw, "experimental")
	trimmed, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	ctx := officialinclude.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[officialoption.Options](ctx, trimmed)
	if err != nil {
		t.Fatalf("official sing-box rejected the config: %v", err)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	instance, err := officialbox.New(officialbox.Options{Context: ctx, Options: options})
	if err != nil {
		t.Fatalf("official sing-box could not construct the config: %v", err)
	}
	_ = instance.Close()
}

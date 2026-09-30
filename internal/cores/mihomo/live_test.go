package mihomo

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	"github.com/metacubex/mihomo/tunnel/statistic"
	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// TestReportedRulesMapBack runs mihomo on a translated config, sends a
// connection through it, and checks that the rule mihomo reports maps back
// to the routing rule that caught it — for a combined rule, which mihomo
// prints differently from how it is written. Needs NUGGET_LIVE and the
// network.
func TestReportedRulesMapBack(t *testing.T) {
	if os.Getenv("NUGGET_LIVE") == "" {
		t.Skip("set NUGGET_LIVE to run mihomo against the network")
	}
	settings := models.DefaultSettings()
	settings.DefaultAction = models.ActionDirect
	settings.RoutingRules = []models.RoutingRule{
		{ID: "combo", Kind: models.SourceLogical, Mode: models.LogicalAnd, Action: models.ActionDirect, Conditions: []models.RoutingCondition{
			{Kind: models.SourceDomains, Values: []string{"nothing.invalid", "cloudflare.com"}},
			{Kind: models.SourceNetwork, Values: []string{"tcp"}},
			{Kind: models.SourcePort, Values: []string{"8000-8080"}, Invert: true},
		}},
	}
	settings.Normalize()
	result, err := Build(Request{Profile: servers[0], Profiles: servers, Settings: settings, MixedPort: 17893})
	if err != nil {
		t.Fatal(err)
	}
	// No tunnel: a test does not run as administrator.
	var config map[string]any
	yaml.Unmarshal(result.YAML, &config)
	config["tun"] = map[string]any{"enable": false}
	data, _ := yaml.Marshal(config)

	dir := t.TempDir()
	C.SetHomeDir(dir)
	C.SetConfig(filepath.Join(dir, "config.yaml"))
	if err := hub.Parse(data); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = hub.Parse([]byte("mode: direct\n"))
		executor.Shutdown()
	}()

	// A slow download, so the connection is still open when asked about.
	proxy, _ := url.Parse("http://127.0.0.1:17893")
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}, Timeout: 20 * time.Second}
	go func() {
		response, err := client.Get("https://speed.cloudflare.com/__down?bytes=20000000")
		if err == nil {
			buffer := make([]byte, 1024)
			for i := 0; i < 50; i++ {
				response.Body.Read(buffer)
				time.Sleep(100 * time.Millisecond)
			}
			response.Body.Close()
		}
	}()
	time.Sleep(2500 * time.Millisecond)

	seen := 0
	statistic.DefaultManager.Range(func(tracker statistic.Tracker) bool {
		info := tracker.Info()
		seen++
		owner := result.RuleOwners[strings.ToLower(info.RulePayload)]
		t.Logf("mihomo reports %s %s → rule %q", info.Rule, info.RulePayload, owner)
		if owner != "combo" {
			t.Errorf("the reported rule did not map back to the combined rule; owners: %v", result.RuleOwners)
		}
		return true
	})
	if seen == 0 {
		t.Fatal("no connection went through mihomo")
	}
}

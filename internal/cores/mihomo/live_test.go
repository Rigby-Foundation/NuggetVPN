package mihomo

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// TestReportedRulesMapBack runs mihomo on a translated config, sends a
// connection through it, and checks that the rule mihomo reports maps back
// to the routing rule that caught it — for a combined rule, which mihomo
// prints differently from how it is written. Needs NUGGET_MIHOMO and the
// network.
func TestReportedRulesMapBack(t *testing.T) {
	binary := os.Getenv("NUGGET_MIHOMO")
	if binary == "" {
		t.Skip("set NUGGET_MIHOMO to run mihomo")
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
	result, err := Build(Request{
		Profile: servers[0], Profiles: servers, Settings: settings,
		MixedPort: 17893, ControllerPort: 19093, ControllerSecret: "s3cret",
	})
	if err != nil {
		t.Fatal(err)
	}
	// No tunnel: a test does not run as administrator.
	var config map[string]any
	yaml.Unmarshal(result.YAML, &config)
	config["tun"] = map[string]any{"enable": false}
	data, _ := yaml.Marshal(config)

	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "config.yaml"), data, 0o600)
	process := exec.Command(binary, "-d", dir, "-f", filepath.Join(dir, "config.yaml"))
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	defer process.Process.Kill()
	time.Sleep(2 * time.Second)

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

	request, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:19093/connections", nil)
	request.Header.Set("Authorization", "Bearer s3cret")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var list struct {
		Connections []struct {
			Rule        string `json:"rule"`
			RulePayload string `json:"rulePayload"`
		} `json:"connections"`
	}
	json.NewDecoder(response.Body).Decode(&list)
	if len(list.Connections) == 0 {
		t.Fatal("no connection went through mihomo")
	}
	for _, connection := range list.Connections {
		owner := result.RuleOwners[strings.ToLower(connection.RulePayload)]
		t.Logf("mihomo reports %s %s → rule %q", connection.Rule, connection.RulePayload, owner)
		if owner != "combo" {
			t.Errorf("the reported rule did not map back to the combined rule; owners: %v", result.RuleOwners)
		}
	}
}

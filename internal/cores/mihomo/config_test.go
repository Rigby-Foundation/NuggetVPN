package mihomo

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
)

const (
	mainLink = "vless://11111111-2222-3333-4444-555555555555@reality.example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#Main"
)

var servers = []models.Profile{
	{ID: "main", Name: "Main", ConfigLink: mainLink},
	{ID: "jp", Name: "Tokyo", ConfigLink: "trojan://password@jp.example.com:443?sni=jp.example.com&type=grpc&serviceName=tg#JP"},
	{ID: "ws", Name: "WS", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@ws.example.com:443?encryption=none&security=tls&sni=ws.example.com&type=ws&path=%2Fws%3Fed%3D2048&host=ws.example.com#WS"},
	{ID: "hy2", Name: "Hy2", ConfigLink: "hy2://password@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=op#HY2"},
	{ID: "tuic", Name: "TUIC", ConfigLink: "tuic://11111111-2222-3333-4444-555555555555:password@tuic.example.com:443?congestion_control=bbr&alpn=h3#TUIC"},
	{ID: "ss", Name: "SS", ConfigLink: "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@ss.example.com:8388#SS"},
	{ID: "wg", Name: "WG", ConfigLink: "wireguard://cHJpdmF0ZWtleXByaXZhdGVrZXlwcml2YXRla2V5MTI%3D@wg.example.com:51820?address=10.0.0.2%2F32&publickey=cHVibGlja2V5cHVibGlja2V5cHVibGlja2V5MTIzND0%3D&mtu=1280#WG"},
	{ID: "hop", Name: "Hop", ConfigLink: "trojan://pw@hop.example.com:443?sni=hop.example.com#H"},
}

func featureRequest(t *testing.T) Request {
	listPath := filepath.Join(t.TempDir(), "list.json")
	os.WriteFile(listPath, []byte(`{"version":3,"rules":[{"domain":["a.example"],"domain_suffix":[".blocked.example"]},{"ip_cidr":["203.0.113.0/24"]}]}`), 0o644)

	settings := models.DefaultSettings()
	settings.DefaultAction = models.ActionDirect
	settings.ProxyChainEnabled = true
	settings.ProxyChain = []string{"hop"}
	settings.RoutingRules = []models.RoutingRule{
		{ID: "combo", Kind: models.SourceLogical, Mode: models.LogicalAnd, Action: models.ActionDirect, Conditions: []models.RoutingCondition{
			{Kind: models.SourceApps, Values: []string{"Telegram.exe"}},
			{Kind: models.SourceNetwork, Values: []string{"udp"}},
		}},
		{ID: "except", Kind: models.SourceLogical, Mode: models.LogicalOr, Action: models.ActionProxy, Conditions: []models.RoutingCondition{
			{Kind: models.SourceDomains, Values: []string{"google.com", "gstatic.com"}},
			{Kind: models.SourcePort, Values: []string{"8000-8080"}, Invert: true},
		}},
		{ID: "stream", Kind: models.SourceDomains, Values: []string{"netflix.com", "*.nflxvideo.net"}, Action: models.ActionProxy, Server: "jp", DNS: "https://dns.google/dns-query"},
		{ID: "notff", Kind: models.SourceApps, Values: []string{"firefox.exe"}, Invert: true, Action: models.ActionBlock},
		{ID: "udp", Kind: models.SourceNetwork, Values: []string{"udp"}, Action: models.ActionDrop},
		{ID: "ips", Kind: models.SourceIP, Values: []string{"1.1.1.0/24", "2606:4700::/32"}, Action: models.ActionProxy},
		{ID: "regex", Kind: models.SourceDomainRegex, Values: []string{`^ads?\.`}, Action: models.ActionBlock},
		{ID: "lists", Kind: models.SourceRuleSet, Values: []string{"https://lists.example/blocked.lst", "https://lists.example/ads.srs"}, Action: models.ActionProxy},
		{ID: "proto", Kind: models.SourceProtocol, Values: []string{"bittorrent"}, Action: models.ActionDirect},
		{ID: "geo", Kind: models.SourceGeoIP, Values: []string{"ru"}, Action: models.ActionDirect},
	}
	settings.Normalize()
	return Request{
		Profile: servers[0], Profiles: servers, Settings: settings,
		Alternatives:     servers[:7],
		MixedPort:        17890,
		RuleLists:        map[string]sbconfig.RuleList{"https://lists.example/blocked.lst": {Path: listPath}},
		ControllerPort:   19090,
		ControllerSecret: "s3cret",
	}
}

func TestBuildTranslatesTheGraph(t *testing.T) {
	result, err := Build(featureRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	text := string(result.YAML)
	for _, want := range []string{
		"AND,((PROCESS-NAME,Telegram.exe),(NETWORK,UDP)),DIRECT",
		"OR,((OR,((DOMAIN-SUFFIX,google.com),(DOMAIN-SUFFIX,gstatic.com))),(NOT,((DST-PORT,8000-8080)))),PROXY",
		"DOMAIN-SUFFIX,netflix.com,Tokyo",
		"DOMAIN-SUFFIX,nflxvideo.net,Tokyo",
		"NOT,((PROCESS-NAME,firefox.exe)),REJECT",
		"NETWORK,UDP,REJECT-DROP",
		"IP-CIDR6,2606:4700::/32,PROXY,no-resolve",
		"GEOIP,RU,DIRECT,no-resolve",
		"MATCH,DIRECT",
		"type: url-test",
		"dialer-proxy: Hop",
		"+.netflix.com: https://dns.google:443/dns-query",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
	// The things mihomo has no equivalent for are reported, not dropped
	// silently: detected protocols and sing-box's own rule-set files.
	joined := strings.Join(result.Warnings, "\n")
	if !strings.Contains(joined, "protocol") || !strings.Contains(joined, "ads.srs") {
		t.Errorf("warnings: %v", result.Warnings)
	}
	if result.RuleOwners["netflix.com"] != "stream" || result.RuleOwners["match"] != sbconfig.DefaultOwner {
		t.Errorf("owners: %v", result.RuleOwners)
	}
	if result.ServerFor["Tokyo"] != "jp" {
		t.Errorf("server names: %v", result.ServerFor)
	}

	// mihomo's own check, when a binary is at hand (NUGGET_MIHOMO=path).
	binary := os.Getenv("NUGGET_MIHOMO")
	if binary == "" {
		t.Log("set NUGGET_MIHOMO to check the config with mihomo itself")
		return
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "config.yaml")
	os.WriteFile(file, result.YAML, 0o600)
	output, err := exec.Command(binary, "-t", "-d", dir, "-f", file).CombinedOutput()
	if err != nil || !strings.Contains(string(output), "successful") {
		t.Fatalf("mihomo rejected the config: %v\n%s\n%s", err, output, result.YAML)
	}
	t.Logf("mihomo accepts it: %s", lastLine(string(output)))
}

func TestFullClashConfigRunsVerbatim(t *testing.T) {
	clash := `proxies:
  - {name: A, type: ss, server: a.example, port: 8388, cipher: aes-256-gcm, password: pw}
proxy-groups:
  - {name: G, type: select, proxies: [A]}
rules:
  - DOMAIN-SUFFIX,example.com,G
  - MATCH,DIRECT
external-ui: /etc/passwd
`
	request := featureRequest(t)
	request.Profile = models.Profile{ID: "c", Name: "Clash", ConfigLink: clash}
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	yaml.Unmarshal(result.YAML, &config)
	if !result.Verbatim || config["secret"] != "s3cret" || config["tun"] == nil || config["external-ui"] != nil {
		t.Errorf("verbatim config not prepared: %+v", config)
	}
	rules, _ := config["rules"].([]any)
	if len(rules) != 2 {
		t.Errorf("the config's own rules should be kept: %v", rules)
	}
}

func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	return lines[len(lines)-1]
}

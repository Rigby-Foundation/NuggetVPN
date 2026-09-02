package sbconfig

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// buildFor generates a config for a single link using default settings.
func buildFor(t *testing.T, configLink string, mutate func(*models.AppSettings)) Result {
	t.Helper()

	settings := models.DefaultSettings()
	if mutate != nil {
		mutate(&settings)
	}

	result, err := Build(Request{
		Profile:  models.Profile{ID: "p1", Name: "test", ConfigLink: configLink},
		Profiles: []models.Profile{{ID: "p1", ConfigLink: configLink}},
		Settings: settings,
	})
	if err != nil {
		t.Fatalf("Build(%q) failed: %v", configLink, err)
	}
	return result
}

// mustParse feeds a generated config through sing-box's own option decoder,
// which is the same path `sing-box run` takes.
func mustParse(t *testing.T, configJSON []byte) option.Options {
	t.Helper()

	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, configJSON)
	if err != nil {
		t.Fatalf("sing-box rejected the generated config: %v\n%s", err, configJSON)
	}
	return options
}

// The links below cover every scheme the app accepts.
var protocolLinks = map[string]string{
	"vless-reality": "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome" +
		"&pbk=MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs&sid=0123abcd&type=tcp" +
		"&flow=xtls-rprx-vision#Reality%20Node",
	"vless-ws-tls": "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?encryption=none&security=tls&sni=example.com&type=ws&path=%2Fws%3Fed%3D2048&host=example.com#WS",
	"vless-grpc": "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?encryption=none&security=tls&type=grpc&serviceName=gsvc#GRPC",
	"vmess": "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MgTm9kZSIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9y" +
		"dCI6IjQ0MyIsImlkIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1IiwiYWlkIjoi" +
		"MCIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInR5cGUiOiJub25lIiwiaG9zdCI6ImV4YW1wbGUuY29t" +
		"IiwicGF0aCI6Ii93cyIsInRscyI6InRscyIsInNuaSI6ImV4YW1wbGUuY29tIn0=",
	"trojan":      "trojan://password@example.com:443?sni=example.com&type=tcp#Trojan",
	"trojan-grpc": "trojan://password@example.com:443?sni=example.com&type=grpc&serviceName=tg#TrojanGRPC",
	"ss-sip002":   "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#SS",
	"ss-legacy":   "ss://YWVzLTI1Ni1nY206cGFzc3dvcmRAZXhhbXBsZS5jb206ODM4OA==#SSLegacy",
	"ss-plugin": "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388" +
		"?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Bhost%3Dexample.com#SSPlugin",
	"hysteria2":  "hy2://password@example.com:443?sni=example.com&obfs=salamander&obfs-password=op#HY2",
	"hysteria":   "hysteria://example.com:443?auth=secret&peer=example.com&upmbps=50&downmbps=200&alpn=h3#HY1",
	"tuic":       "tuic://11111111-2222-3333-4444-555555555555:password@example.com:443?congestion_control=bbr&alpn=h3#TUIC",
	"wireguard":  "wireguard://cHJpdmF0ZWtleXByaXZhdGVrZXlwcml2YXRla2V5MTI%3D@example.com:51820?address=10.0.0.2%2F32&publickey=cHVibGlja2V5cHVibGlja2V5cHVibGlja2V5MTIzND0%3D&mtu=1280#WG",
	"socks5":     "socks5://user:pass@example.com:1080#SOCKS",
	"http-proxy": "https://user:pass@example.com:8443#HTTP",
	"ssh":        "ssh://root:password@example.com:22#SSH",
}

func TestBuildAcceptedBySingBox(t *testing.T) {
	for name, configLink := range protocolLinks {
		t.Run(name, func(t *testing.T) {
			result := buildFor(t, configLink, nil)
			options := mustParse(t, result.JSON)

			if len(options.Inbounds) == 0 {
				t.Fatalf("expected a TUN inbound, got none")
			}
			if name == "wireguard" {
				if len(options.Endpoints) != 1 {
					t.Fatalf("wireguard must land in endpoints, got %d", len(options.Endpoints))
				}
				return
			}
			// Exit proxy + direct.
			if len(options.Outbounds) != 2 {
				t.Fatalf("expected 2 outbounds, got %d", len(options.Outbounds))
			}
			if options.Outbounds[0].Tag != ExitTag {
				t.Fatalf("expected exit tag %q, got %q", ExitTag, options.Outbounds[0].Tag)
			}
		})
	}
}

// TestRealityEmitsUTLS guards the bug that motivated the rewrite: sing-box
// implements Reality on top of uTLS, so a Reality config without a uTLS block
// fails to hand shake.
func TestRealityEmitsUTLS(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], nil)

	var config struct {
		Outbounds []struct {
			Tag string `json:"tag"`
			TLS struct {
				Enabled    bool   `json:"enabled"`
				ServerName string `json:"server_name"`
				UTLS       struct {
					Enabled     bool   `json:"enabled"`
					Fingerprint string `json:"fingerprint"`
				} `json:"utls"`
				Reality struct {
					Enabled   bool   `json:"enabled"`
					PublicKey string `json:"public_key"`
					ShortID   string `json:"short_id"`
				} `json:"reality"`
			} `json:"tls"`
			Flow string `json:"flow"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	exit := config.Outbounds[0]
	switch {
	case !exit.TLS.Enabled:
		t.Fatal("TLS must be enabled for Reality")
	case !exit.TLS.Reality.Enabled:
		t.Fatal("reality block missing")
	case !exit.TLS.UTLS.Enabled:
		t.Fatal("uTLS must be enabled whenever Reality is used")
	case exit.TLS.UTLS.Fingerprint != "chrome":
		t.Fatalf("expected chrome fingerprint, got %q", exit.TLS.UTLS.Fingerprint)
	case exit.TLS.Reality.PublicKey != "MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs":
		t.Fatalf("public key not carried over: %q", exit.TLS.Reality.PublicKey)
	case exit.TLS.Reality.ShortID != "0123abcd":
		t.Fatalf("short id not carried over: %q", exit.TLS.Reality.ShortID)
	case exit.TLS.ServerName != "www.microsoft.com":
		t.Fatalf("unexpected SNI %q", exit.TLS.ServerName)
	case exit.Flow != "xtls-rprx-vision":
		t.Fatalf("vision flow dropped: %q", exit.Flow)
	}
}

// TestRealityOutboundConstructs proves sing-box can actually instantiate the
// Reality dialer from our config, not merely parse it.
func TestRealityOutboundConstructs(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], nil)

	// Drop the TUN inbound: creating it needs root, and this test only cares
	// about the outbound side.
	var raw map[string]any
	if err := json.Unmarshal(result.JSON, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	delete(raw, "inbounds")
	delete(raw, "experimental")
	trimmed, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, trimmed)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		t.Fatalf("sing-box could not construct the Reality outbound: %v", err)
	}
	if err := instance.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// TestFlowDroppedForNonTCPTransport documents why VLESS+WS+Vision must not be
// emitted: XTLS Vision only exists on the raw TCP transport.
func TestFlowDroppedForNonTCPTransport(t *testing.T) {
	configLink := "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?security=tls&type=ws&path=/&flow=xtls-rprx-vision"
	result := buildFor(t, configLink, nil)
	if strings.Contains(string(result.JSON), "xtls-rprx-vision") {
		t.Fatalf("flow must be dropped for websocket transports:\n%s", result.JSON)
	}
	mustParse(t, result.JSON)
}

func TestFullTunnelUsesFakeIP(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], nil)
	options := mustParse(t, result.JSON)

	if options.Route.Final != ExitTag {
		t.Fatalf("full tunnel must default to the proxy, got %q", options.Route.Final)
	}
	if !strings.Contains(string(result.JSON), "fakeip") {
		t.Fatal("full tunnel should enable fake-IP DNS")
	}
	// The proxy's own hostname must resolve for real.
	if !strings.Contains(string(result.JSON), `"domain": [`) {
		t.Fatalf("expected a DNS rule pinning the server domain to the direct resolver:\n%s", result.JSON)
	}
}

func TestSplitTunnelRoutesDirectByDefault(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], func(settings *models.AppSettings) {
		settings.RoutingMode = models.RoutingAppsDomains
		settings.RoutingDomains = []string{"example.org", "example.net"}
		settings.RoutingApps = []string{"Safari.app"}
	})
	options := mustParse(t, result.JSON)

	if options.Route.Final != DirectTag {
		t.Fatalf("split tunnel must default to direct, got %q", options.Route.Final)
	}
	if strings.Contains(string(result.JSON), "fakeip") {
		t.Fatal("split tunnel must not use fake-IP, direct traffic needs real addresses")
	}
	if result.SplitRules == 0 {
		t.Fatal("expected split rules to be generated")
	}
}

// TestLegacySelectedRoutingMode covers settings.json files written by the old
// build, which used "selected" instead of "apps_domains".
func TestLegacySelectedRoutingMode(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], func(settings *models.AppSettings) {
		settings.RoutingMode = "selected"
		settings.RoutingDomains = []string{"example.org"}
	})
	options := mustParse(t, result.JSON)
	if options.Route.Final != DirectTag {
		t.Fatalf(`"selected" must behave like split tunnelling, got final %q`, options.Route.Final)
	}
}

func TestProxyChainUsesDetour(t *testing.T) {
	exitLink := protocolLinks["vless-reality"]
	hopLink := protocolLinks["trojan"]

	settings := models.DefaultSettings()
	settings.ProxyChainEnabled = true
	settings.ProxyChain = []string{"hop1"}

	result, err := Build(Request{
		Profile: models.Profile{ID: "exit", ConfigLink: exitLink},
		Profiles: []models.Profile{
			{ID: "exit", ConfigLink: exitLink},
			{ID: "hop1", Name: "hop", ConfigLink: hopLink},
		},
		Settings: settings,
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	options := mustParse(t, result.JSON)

	if result.ChainHops != 1 {
		t.Fatalf("expected 1 chain hop, got %d", result.ChainHops)
	}
	var config struct {
		Outbounds []struct {
			Tag    string `json:"tag"`
			Detour string `json:"detour"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var exit struct {
		Tag    string
		Detour string
	}
	for _, outbound := range config.Outbounds {
		if outbound.Tag == ExitTag {
			exit.Tag, exit.Detour = outbound.Tag, outbound.Detour
		}
	}
	if exit.Detour != "chain-1" {
		t.Fatalf("exit outbound must detour through the chain tail, got %q", exit.Detour)
	}
	if len(options.Outbounds) != 3 {
		t.Fatalf("expected hop + exit + direct, got %d", len(options.Outbounds))
	}
}

// TestCustomSingBoxConfigPassthrough covers the feature that used to be
// "sing-box config converted to Clash YAML" and is now native.
func TestCustomSingBoxConfigPassthrough(t *testing.T) {
	custom := `{
      "inbounds": [{"type":"mixed","tag":"in","listen":"127.0.0.1","listen_port":2080}],
      "outbounds": [{"type":"direct","tag":"direct"}],
      "route": {"final":"direct"}
    }`
	result := buildFor(t, custom, nil)
	if !result.Verbatim {
		t.Fatal("a full sing-box config must be passed through untouched")
	}
	options := mustParse(t, result.JSON)
	if len(options.Inbounds) != 1 || options.Inbounds[0].Tag != "in" {
		t.Fatalf("custom inbounds were rewritten: %+v", options.Inbounds)
	}
}

// TestOutboundsOnlyJSONIsWrapped checks that a bare outbound document still
// gets the app's TUN, DNS and routing layered on top.
func TestOutboundsOnlyJSONIsWrapped(t *testing.T) {
	custom := `{"outbounds":[{"type":"trojan","tag":"proxy","server":"example.com","server_port":443,"password":"pw"}]}`
	result := buildFor(t, custom, nil)
	if result.Verbatim {
		t.Fatal("an outbounds-only document must not be treated as a full config")
	}
	options := mustParse(t, result.JSON)
	if len(options.Inbounds) == 0 {
		t.Fatal("expected the generated TUN inbound")
	}
}

func TestRigbyLinkReportsUnsupported(t *testing.T) {
	_, err := Build(Request{
		Profile:  models.Profile{ID: "p", ConfigLink: "rigby://pubkey@example.com:443?padding=1"},
		Settings: models.DefaultSettings(),
	})
	if err == nil {
		t.Fatal("rigby:// must be reported as unsupported")
	}
	if !strings.Contains(err.Error(), "rigby") {
		t.Fatalf("error should name the protocol, got %v", err)
	}
}

// TestNoExternalController pins the decision to keep sing-box's Clash API
// listener switched off. An external_controller would publish an
// unauthenticated control plane for the privileged core on loopback, served
// with permissive CORS, so any local process or visited web page could read the
// live connection list and drive the tunnel. The counters are read in-process
// instead; the empty clash_api block is what builds them.
func TestNoExternalController(t *testing.T) {
	result := buildFor(t, protocolLinks["vless-reality"], nil)

	var config struct {
		Experimental struct {
			ClashAPI *struct {
				ExternalController string `json:"external_controller"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}
	if err := json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatalf("decode config: %v", err)
	}

	if config.Experimental.ClashAPI == nil {
		t.Fatal("clash_api block is missing; traffic counters would not be built")
	}
	if config.Experimental.ClashAPI.ExternalController != "" {
		t.Fatalf("config publishes a Clash API listener on %q",
			config.Experimental.ClashAPI.ExternalController)
	}
}

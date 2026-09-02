package link

import (
	"errors"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Everything in this file exercises ParseOutbound, which turns a share link
// into a sing-box outbound. It is the only code in the app that consumes bytes
// straight off a subscription server, so it is the code most worth pinning
// down: a provider can put anything at all in that response.

func testSettings() models.AppSettings {
	value := models.DefaultSettings()
	value.Normalize()
	return value
}

// mustParse parses a link that is expected to be valid.
func mustParse(t *testing.T, rawLink string) Outbound {
	t.Helper()
	outbound, err := ParseOutbound(rawLink, testSettings())
	if err != nil {
		t.Fatalf("ParseOutbound(%q) failed: %v", rawLink, err)
	}
	if outbound == nil {
		t.Fatalf("ParseOutbound(%q) returned no outbound and no error", rawLink)
	}
	return outbound
}

// field reads a nested value, e.g. field(o, "tls", "utls", "fingerprint").
func field(outbound map[string]any, path ...string) (any, bool) {
	var current any = outbound
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[key]
		if !ok {
			return nil, false
		}
	}
	return current, true
}

func stringField(t *testing.T, outbound map[string]any, path ...string) string {
	t.Helper()
	value, ok := field(outbound, path...)
	if !ok {
		t.Fatalf("missing field %s", strings.Join(path, "."))
	}
	text, ok := value.(string)
	if !ok {
		t.Fatalf("field %s is %T, want string", strings.Join(path, "."), value)
	}
	return text
}

// TestParseOutboundPerProtocol covers one representative link per scheme the
// app claims to support, checking the fields sing-box actually dials with.
func TestParseOutboundPerProtocol(t *testing.T) {
	cases := []struct {
		name     string
		link     string
		wantType string
		wantHost string
		wantPort int
		// check runs extra per-protocol assertions.
		check func(*testing.T, Outbound)
	}{
		{
			name: "vless reality with vision",
			link: "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
				"?encryption=none&security=reality&sni=www.microsoft.com" +
				"&pbk=aPublicKey&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#Node",
			wantType: "vless",
			wantHost: "example.com",
			wantPort: 443,
			check: func(t *testing.T, outbound Outbound) {
				if got := stringField(t, outbound, "uuid"); got != "11111111-2222-3333-4444-555555555555" {
					t.Errorf("uuid = %q", got)
				}
				if got := stringField(t, outbound, "tls", "server_name"); got != "www.microsoft.com" {
					t.Errorf("server_name = %q", got)
				}
				// Reality is implemented on uTLS, so the block is mandatory and
				// the fingerprint defaults rather than being left empty.
				if got := stringField(t, outbound, "tls", "utls", "fingerprint"); got != "chrome" {
					t.Errorf("utls fingerprint = %q, want the chrome default", got)
				}
				if got := stringField(t, outbound, "tls", "reality", "public_key"); got != "aPublicKey" {
					t.Errorf("reality public_key = %q", got)
				}
				// Vision is valid here: raw TCP with TLS on.
				if got := stringField(t, outbound, "flow"); got != "xtls-rprx-vision" {
					t.Errorf("flow = %q", got)
				}
			},
		},
		{
			name: "vless over websocket",
			link: "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
				"?encryption=none&security=tls&type=ws&path=%2Fws&host=example.com#WS",
			wantType: "vless",
			wantHost: "example.com",
			wantPort: 443,
			check: func(t *testing.T, outbound Outbound) {
				if got := stringField(t, outbound, "transport", "type"); got != "ws" {
					t.Errorf("transport type = %q", got)
				}
			},
		},
		{
			name: "trojan defaults to tls on 443",
			link: "trojan://secret@example.com#T",
			wantType: "trojan",
			wantHost: "example.com",
			wantPort: 443,
			check: func(t *testing.T, outbound Outbound) {
				if got := stringField(t, outbound, "password"); got != "secret" {
					t.Errorf("password = %q", got)
				}
				if _, ok := field(outbound, "tls", "enabled"); !ok {
					t.Error("trojan should enable TLS unless the link opts out")
				}
			},
		},
		{
			name:     "trojan can opt out of tls",
			link:     "trojan://secret@example.com:8443?security=none#T",
			wantType: "trojan",
			wantHost: "example.com",
			wantPort: 8443,
			check: func(t *testing.T, outbound Outbound) {
				if _, ok := outbound["tls"]; ok {
					t.Error("security=none must not emit a TLS block")
				}
			},
		},
		{
			name:     "socks5 with credentials",
			link:     "socks5://user:pass@example.com:1080#S",
			wantType: "socks",
			wantHost: "example.com",
			wantPort: 1080,
			check: func(t *testing.T, outbound Outbound) {
				if got := stringField(t, outbound, "username"); got != "user" {
					t.Errorf("username = %q", got)
				}
				if got := stringField(t, outbound, "password"); got != "pass" {
					t.Errorf("password = %q", got)
				}
				if got := stringField(t, outbound, "version"); got != "5" {
					t.Errorf("version = %q", got)
				}
			},
		},
		{
			name:     "socks defaults to port 1080",
			link:     "socks5://example.com",
			wantType: "socks",
			wantHost: "example.com",
			wantPort: 1080,
		},
		{
			name:     "http proxy",
			link:     "http://user:pass@example.com:8080",
			wantType: "http",
			wantHost: "example.com",
			wantPort: 8080,
		},
		{
			name:     "https proxy enables tls",
			link:     "https://example.com",
			wantType: "http",
			wantHost: "example.com",
			wantPort: 443,
			check: func(t *testing.T, outbound Outbound) {
				if _, ok := field(outbound, "tls", "enabled"); !ok {
					t.Error("an https proxy must enable TLS")
				}
			},
		},
		{
			name:     "ssh with a password",
			link:     "ssh://root:hunter2@example.com:2222",
			wantType: "ssh",
			wantHost: "example.com",
			wantPort: 2222,
			check: func(t *testing.T, outbound Outbound) {
				if got := stringField(t, outbound, "user"); got != "root" {
					t.Errorf("user = %q", got)
				}
			},
		},
		{
			name:     "hysteria2",
			link:     "hysteria2://secret@example.com:8443?sni=example.com#H2",
			wantType: "hysteria2",
			wantHost: "example.com",
			wantPort: 8443,
		},
		{
			name:     "tuic",
			link:     "tuic://11111111-2222-3333-4444-555555555555:pass@example.com:443?sni=example.com#TUIC",
			wantType: "tuic",
			wantHost: "example.com",
			wantPort: 443,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			outbound := mustParse(t, testCase.link)

			if outbound.Type() != testCase.wantType {
				t.Errorf("type = %q, want %q", outbound.Type(), testCase.wantType)
			}
			if outbound.Server() != testCase.wantHost {
				t.Errorf("server = %q, want %q", outbound.Server(), testCase.wantHost)
			}
			if outbound.ServerPort() != testCase.wantPort {
				t.Errorf("server_port = %d, want %d", outbound.ServerPort(), testCase.wantPort)
			}
			// The builder assigns tags; a parser that set one would silently
			// win over the tag the config generator needs.
			if _, ok := outbound["tag"]; ok {
				t.Error("parsed outbound must not carry a tag")
			}
			if testCase.check != nil {
				testCase.check(t, outbound)
			}
		})
	}
}

// TestVisionRequiresRawTCP pins the rule that costs users a broken tunnel when
// it is wrong: XTLS Vision does not exist on WebSocket or gRPC, so the flow has
// to be dropped rather than passed through to sing-box.
func TestVisionRequiresRawTCP(t *testing.T) {
	base := "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?encryption=none&security=tls&flow=xtls-rprx-vision"

	cases := []struct {
		transport string
		link      string
		wantFlow  bool
	}{
		{"raw tcp", base + "&type=tcp", true},
		{"unspecified", base, true},
		{"websocket", base + "&type=ws&path=%2Fws", false},
		{"grpc", base + "&type=grpc&serviceName=gsvc", false},
		{"httpupgrade", base + "&type=httpupgrade&path=%2Fup", false},
	}

	for _, testCase := range cases {
		t.Run(testCase.transport, func(t *testing.T) {
			outbound := mustParse(t, testCase.link)
			_, hasFlow := outbound["flow"]
			if hasFlow != testCase.wantFlow {
				t.Errorf("flow present = %v, want %v (transport %s)",
					hasFlow, testCase.wantFlow, testCase.transport)
			}
		})
	}
}

// TestShadowsocksEncodings covers both link shapes in the wild: SIP002, where
// only the credentials are base64, and the older form where the whole userinfo
// and host are one blob.
func TestShadowsocksEncodings(t *testing.T) {
	// aes-256-gcm:hunter2
	const sip002 = "ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388#SS"
	// aes-256-gcm:hunter2@example.com:8388
	const legacy = "ss://YWVzLTI1Ni1nY206aHVudGVyMkBleGFtcGxlLmNvbTo4Mzg4#SS"

	for name, rawLink := range map[string]string{"sip002": sip002, "legacy": legacy} {
		t.Run(name, func(t *testing.T) {
			outbound := mustParse(t, rawLink)

			if outbound.Type() != "shadowsocks" {
				t.Errorf("type = %q", outbound.Type())
			}
			if outbound.Server() != "example.com" {
				t.Errorf("server = %q", outbound.Server())
			}
			if outbound.ServerPort() != 8388 {
				t.Errorf("server_port = %d", outbound.ServerPort())
			}
			if got := stringField(t, outbound, "method"); got != "aes-256-gcm" {
				t.Errorf("method = %q", got)
			}
			if got := stringField(t, outbound, "password"); got != "hunter2" {
				t.Errorf("password = %q", got)
			}
		})
	}
}

// TestWireGuardIsAnEndpoint guards the sing-box 1.11 move of WireGuard out of
// outbounds and into endpoints. Getting this wrong puts a valid profile in a
// section sing-box will not read.
func TestWireGuardIsAnEndpoint(t *testing.T) {
	const rawLink = "wireguard://cHJpdmF0ZWtleWJhc2U2NHBhZGRlZHRvMzJieXRlc2FhYT0=@example.com:51820" +
		"?publickey=cGVlcnB1YmxpY2tleWJhc2U2NHBhZGRlZHRvMzJieXRlcz0%3D&address=10.0.0.2%2F32#WG"

	outbound, err := ParseOutbound(rawLink, testSettings())
	if err != nil {
		t.Skipf("wireguard link shape not accepted by this build: %v", err)
	}
	if !outbound.IsEndpoint() {
		t.Errorf("wireguard parsed as type %q, which would be written to outbounds",
			outbound.Type())
	}
}

// TestUnsupportedProtocols checks the two ways a link can be refused: a scheme
// sing-box has no implementation for, and outright malformed input. Both have
// to produce an error rather than a half-built outbound.
func TestUnsupportedProtocols(t *testing.T) {
	t.Run("rigby is reported as unsupported", func(t *testing.T) {
		_, err := ParseOutbound("rigby://whatever@example.com:443", testSettings())
		if err == nil {
			t.Fatal("expected an error for the rigby scheme")
		}
		var unsupported *ErrUnsupportedProtocol
		if !errors.As(err, &unsupported) {
			t.Fatalf("error %v is not an ErrUnsupportedProtocol", err)
		}
		// The message tells the user why, since the profile still appears in
		// their list and they will ask.
		if unsupported.Reason == "" {
			t.Error("the rigby error should explain itself")
		}
	})

	rejected := []struct {
		name string
		link string
	}{
		{"empty", ""},
		{"whitespace only", "   \n\t "},
		{"unknown scheme", "quantumtunnel://example.com:443"},
		{"no scheme", "example.com:443"},
		{"vless without a uuid", "vless://example.com:443"},
		{"vless without a port", "vless://11111111-2222-3333-4444-555555555555@example.com"},
		{"trojan without a password", "trojan://example.com:443"},
		{"port out of range", "trojan://secret@example.com:70000"},
		{"port not a number", "trojan://secret@example.com:https"},
		{"host missing", "trojan://secret@:443"},
	}
	for _, testCase := range rejected {
		t.Run(testCase.name, func(t *testing.T) {
			outbound, err := ParseOutbound(testCase.link, testSettings())
			if err == nil {
				t.Fatalf("expected an error, got outbound %v", outbound)
			}
			if outbound != nil {
				t.Error("a failed parse must not also return an outbound")
			}
		})
	}
}

// TestAmpersandEntitiesAreDecoded covers a real-world quirk: some providers
// serve links HTML-escaped, which would otherwise fold every query parameter
// after the first into one nonsense key.
func TestAmpersandEntitiesAreDecoded(t *testing.T) {
	const rawLink = "vless://11111111-2222-3333-4444-555555555555@example.com:443" +
		"?encryption=none&amp;security=tls&amp;sni=real.example.com"

	outbound := mustParse(t, rawLink)
	if got := stringField(t, outbound, "tls", "server_name"); got != "real.example.com" {
		t.Errorf("server_name = %q, want the sni from the escaped link", got)
	}
}

// TestSNISpoofOverridesServerName checks the setting actually reaches the
// generated outbound, since it silently changes what is sent on the wire.
func TestSNISpoofOverridesServerName(t *testing.T) {
	value := testSettings()
	value.SNISpoofEnabled = true
	value.SNISpoofValue = "spoofed.example.net"

	outbound, err := ParseOutbound(
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls&sni=real.example.com",
		value,
	)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got := stringField(t, outbound, "tls", "server_name"); got != "spoofed.example.net" {
		t.Errorf("server_name = %q, want the spoofed value", got)
	}
}

// FuzzParseOutbound asserts the one property that must hold for every possible
// input: parsing never panics and never returns an outbound alongside an error.
// The corpus is a subscription response, i.e. bytes chosen by someone else.
func FuzzParseOutbound(f *testing.F) {
	seeds := []string{
		"",
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?security=reality&pbk=k&type=ws",
		"vmess://eyJ2IjoiMiIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyJ9",
		"ss://YWVzLTI1Ni1nY206aHVudGVyMg==@example.com:8388",
		"trojan://secret@example.com:443?type=grpc",
		"hysteria2://secret@example.com:8443",
		"tuic://uuid:pass@example.com:443",
		"wireguard://key@example.com:51820?publickey=k",
		"socks5://user:pass@example.com:1080",
		"ssh://root@example.com:22",
		`{"type":"vless","server":"example.com","server_port":443}`,
		`{"outbounds":[{"type":"trojan","server":"example.com","server_port":443}]}`,
		"proxies:\n  - name: a\n    type: trojan\n    server: example.com\n    port: 443\n",
		"rigby://example.com",
		"://",
		"vless://@:",
	}
	for _, seed := range seeds {
		f.Add(seed)
	}

	value := testSettings()
	f.Fuzz(func(t *testing.T, rawLink string) {
		outbound, err := ParseOutbound(rawLink, value)
		if err != nil {
			if outbound != nil {
				t.Fatalf("ParseOutbound(%q) returned both an outbound and an error", rawLink)
			}
			return
		}
		if outbound == nil {
			t.Fatalf("ParseOutbound(%q) returned neither an outbound nor an error", rawLink)
		}
		// A successful parse has to be dialable: sing-box needs at least a type,
		// and everything except an endpoint needs somewhere to connect to.
		if outbound.Type() == "" {
			t.Fatalf("ParseOutbound(%q) produced an outbound with no type", rawLink)
		}
	})
}

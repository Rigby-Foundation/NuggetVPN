package link

import (
	"strings"
	"testing"
)

func TestClashProxiesAsLinks(t *testing.T) {
	const body = `mixed-port: 7890
allow-lan: false
proxies:
  - {name: "🇩🇪 Germany", type: trojan, server: de.example.com, port: 443, password: secret, sni: de.example.com}
  - {name: Office, type: ss, server: 10.0.0.1, port: 8388, cipher: aes-256-gcm, password: pw}
  - {name: Odd, type: snell, server: x.example.com, port: 1}
proxy-groups:
  - {name: PROXY, type: select, proxies: ["🇩🇪 Germany", Office]}
`
	links, ok := ClashProxiesAsLinks(body)
	if !ok {
		t.Fatal("a Clash config was not recognised")
	}
	lines := strings.Split(links, "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d links, want 2 (snell has no link): %q", len(lines), links)
	}
	if !strings.HasPrefix(lines[0], "trojan://") || !strings.HasPrefix(lines[1], "ss://") {
		t.Errorf("links = %q", lines)
	}
	if name := ExtractName(lines[0]); name != "🇩🇪 Germany" {
		t.Errorf("name = %q", name)
	}

	if _, ok := ClashProxiesAsLinks("vless://a@1.1.1.1:443#proxies:"); ok {
		t.Error("a link list was read as a Clash config")
	}
}

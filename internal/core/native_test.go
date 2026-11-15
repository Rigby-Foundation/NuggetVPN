package core

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

// Exercise the real service, Xray HTTP/SOCKS inbound, live counters, rule
// tracking and shutdown without a TUN or any administrator permissions.
func TestNativeXrayCarriesTrafficAndTracksConnections(t *testing.T) {
	arrived, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(arrived)
		<-release
		_, _ = io.WriteString(w, "native-xray")
	}))
	defer server.Close()
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	port := freePort(t)
	config, _ := json.Marshal(map[string]any{
		"inbounds":  []any{map[string]any{"tag": "mixed-in", "protocol": "socks", "listen": "127.0.0.1", "port": port, "settings": map[string]any{"auth": "noauth"}}},
		"outbounds": []any{map[string]any{"tag": "direct", "protocol": "freedom"}},
		"routing":   map[string]any{"rules": []any{map[string]any{"type": "field", "network": "tcp,udp", "outboundTag": "direct", "ruleTag": "0"}}},
	})
	client := startTestService(t)
	if err := client.StartConfigured(config, "", 1); err != nil {
		t.Fatal(err)
	}
	proxy, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	transport := &http.Transport{Proxy: http.ProxyURL(proxy)}
	defer transport.CloseIdleConnections()
	browser := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	done := make(chan error, 1)
	go func() {
		response, err := browser.Get(server.URL)
		if err == nil {
			data, readErr := io.ReadAll(response.Body)
			_ = response.Body.Close()
			err = readErr
			if string(data) != "native-xray" {
				err = fmt.Errorf("body: %q", data)
			}
		}
		done <- err
	}()
	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("HTTP proxy request never reached the server")
	}
	connections, ok := client.Connections()
	if !ok || len(connections) != 1 {
		t.Fatalf("connections=%+v, ok=%v", connections, ok)
	}
	if connections[0].Outbound != "direct" || connections[0].Rule != 0 {
		t.Fatalf("unexpected tracked connection: %+v", connections[0])
	}
	hits, ok := client.RuleHits()
	if !ok || len(hits) != 1 || hits[0] != 1 {
		t.Fatalf("rule hits=%v, ok=%v", hits, ok)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	up, down, ok := client.Stats()
	if !ok || up == 0 || down == 0 {
		t.Fatalf("traffic %d/%d, ok=%v", up, down, ok)
	}
	if err := client.Stop(); err != nil {
		t.Fatal(err)
	}
	// The native listener must have been released, ready for the next start.
	if err := client.StartConfigured(config, "", 1); err != nil {
		t.Fatal(err)
	}
	if err := client.CloseConnection(""); err != nil {
		t.Fatal(err)
	}
}

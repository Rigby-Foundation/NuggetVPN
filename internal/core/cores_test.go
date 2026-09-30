package core

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

// through sends one request to a local server through the proxy on port,
// and runs check while the server holds the connection open.
func through(t *testing.T, port int, check func()) {
	t.Helper()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		io.WriteString(w, "ok")
	}))
	defer server.Close()

	proxy, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}, Timeout: 10 * time.Second}
	done := make(chan error, 1)
	go func() {
		response, err := client.Get(server.URL)
		if err == nil {
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if string(body) != "ok" {
				err = fmt.Errorf("body %q", body)
			}
		}
		done <- err
	}()
	time.Sleep(700 * time.Millisecond)
	check()
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("request through the core: %v", err)
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// useTempDataRoot points the cores' data somewhere writable. Not
// t.TempDir: mihomo opens its cache once per process and keeps it open, which
// Windows will not delete from under it.
func useTempDataRoot(t *testing.T) {
	root, err := os.MkdirTemp("", "nuggetvpn-cores-")
	if err != nil {
		t.Fatal(err)
	}
	original, originalLock := dataRoot, lockDataRoot
	dataRoot, lockDataRoot = func() string { return root }, false
	t.Cleanup(func() {
		dataRoot, lockDataRoot = original, originalLock
		_ = os.RemoveAll(root)
	})
}

// Every core runs in this process, one after another, and carries traffic.
// Running them in turn is the point: the two sing-box copies and mihomo
// share one process, and must not trip over each other's globals.
func TestEmbeddedCoresCarryTraffic(t *testing.T) {
	useTempDataRoot(t)
	var instance Instance
	defer instance.Stop()
	sink := func(level, message string) { t.Logf("[%s] %s", level, message) }

	singBoxConfig := func(port int) []byte {
		return mustJSON(t, map[string]any{
			"log":          map[string]any{"level": "warn"},
			"inbounds":     []any{map[string]any{"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": port}},
			"outbounds":    []any{map[string]any{"type": "direct", "tag": "direct"}},
			"route":        map[string]any{"rules": []any{map[string]any{"ip_is_private": true, "outbound": "direct"}}, "final": "direct"},
			"experimental": map[string]any{"clash_api": map[string]any{}},
		})
	}

	for _, name := range []string{CoreBuiltin, CoreSingBox} {
		t.Run(name, func(t *testing.T) {
			port := freePort(t)
			if err := instance.StartCore(StartRequest{Core: name, Config: singBoxConfig(port)}, sink); err != nil {
				t.Fatal(err)
			}
			through(t, port, func() {
				hits, ok := instance.RuleHits()
				if !ok || len(hits) != 2 || hits[0] != 1 {
					t.Errorf("rule hits %v, want the one connection on rule 0", hits)
				}
				open, _ := instance.Connections()
				if len(open) != 1 || open[0].Rule != 0 {
					t.Errorf("connections %+v", open)
				}
			})
			if _, down, ok := instance.Stats(); !ok || down == 0 {
				t.Errorf("no traffic counted")
			}
		})
	}

	t.Run(CoreMihomo, func(t *testing.T) {
		// Twice, so a stop leaves mihomo able to start again.
		for round := 0; round < 2; round++ {
			port := freePort(t)
			config := fmt.Sprintf("mixed-port: %d\nbind-address: 127.0.0.1\nmode: rule\nlog-level: warning\nrules:\n  - MATCH,DIRECT\n", port)
			if err := instance.StartCore(StartRequest{Core: CoreMihomo, Config: []byte(config)}, sink); err != nil {
				t.Fatal(err)
			}
			through(t, port, func() {
				open, _ := instance.Connections()
				if len(open) != 1 || !strings.HasPrefix(open[0].RuleText, "Match") || open[0].Outbound != "DIRECT" {
					t.Errorf("connections %+v", open)
				}
			})
			if err := instance.Stop(); err != nil {
				t.Fatal(err)
			}
		}
	})

	t.Run(CoreXray, func(t *testing.T) {
		// The built-in core hands the connection to Xray on loopback, as
		// it does for a server; Xray lets it out.
		port, xrayPort := freePort(t), freePort(t)
		xray := mustJSON(t, map[string]any{
			"log":       map[string]any{"loglevel": "warning"},
			"inbounds":  []any{map[string]any{"tag": "in-1", "listen": "127.0.0.1", "port": xrayPort, "protocol": "socks", "settings": map[string]any{"auth": "password", "accounts": []any{map[string]any{"user": "u", "pass": "p"}}}}},
			"outbounds": []any{map[string]any{"tag": "out", "protocol": "freedom"}},
		})
		config := mustJSON(t, map[string]any{
			"inbounds": []any{map[string]any{"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": port}},
			"outbounds": []any{map[string]any{
				"type": "socks", "tag": "server", "server": "127.0.0.1", "server_port": xrayPort,
				"username": "u", "password": "p", "inet4_bind_address": "127.0.0.1",
			}},
			"route":        map[string]any{"final": "server"},
			"experimental": map[string]any{"clash_api": map[string]any{}},
		})
		if err := instance.StartCore(StartRequest{Core: CoreXray, Config: config, Aux: xray}, sink); err != nil {
			t.Fatal(err)
		}
		through(t, port, func() {
			open, _ := instance.Connections()
			if len(open) != 1 || open[0].Outbound != "server" {
				t.Errorf("connections %+v", open)
			}
		})
	})
}

func TestCoresReportVersions(t *testing.T) {
	// The built-in core and mihomo are read from the module versions the
	// binary records, which a test binary may not carry.
	info, _ := debug.ReadBuildInfo()
	haveModules := info != nil && len(info.Deps) > 0
	for _, core := range Cores() {
		t.Logf("%s %s", core.Name, core.Version)
		fromModules := core.Name == CoreBuiltin || core.Name == CoreMihomo
		if core.Version == "" && (haveModules || !fromModules) {
			t.Errorf("%s has no version", core.Name)
		}
	}
}

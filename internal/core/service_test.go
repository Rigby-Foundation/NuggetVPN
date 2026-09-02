package core

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// freePort reserves a localhost port so the test config cannot collide with a
// real sing-box instance on the developer's machine.
func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

// testConfig is a minimal sing-box config that needs no elevated privileges:
// a local mixed inbound and a direct outbound, no TUN.
func testConfig(t *testing.T) []byte {
	t.Helper()
	config := map[string]any{
		// Supplying a PlatformLogWriter makes sing-box enable its cache file,
		// which otherwise lands in the package directory as ./cache.db. Pin it
		// to the test's temp dir so the source tree stays clean.
		"experimental": map[string]any{
			"cache_file": map[string]any{
				"enabled": true,
				"path":    filepath.Join(t.TempDir(), "cache.db"),
			},
		},
		"log": map[string]any{"level": "warn"},
		"dns": map[string]any{
			"servers": []any{map[string]any{"type": "udp", "tag": "d", "server": "1.1.1.1"}},
			"final":   "d",
		},
		"inbounds": []any{map[string]any{
			"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": freePort(t),
		}},
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
		"route": map[string]any{
			"final":                   "direct",
			"default_domain_resolver": map[string]any{"server": "d"},
		},
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	return encoded
}

// testToken is the shared secret the test service and client authenticate with.
const testToken = "0123456789abcdef0123456789abcdef"

// startTestService runs the core service on a temporary socket and returns an
// authenticated client.
func startTestService(t *testing.T) *Client {
	t.Helper()
	client, _ := startTestServiceOnSocket(t)
	return client
}

// startTestServiceOnSocket also returns the socket path, for tests that want to
// open their own raw connection to it.
func startTestServiceOnSocket(t *testing.T) (*Client, string) {
	t.Helper()

	directory := t.TempDir()
	socket := filepath.Join(directory, "core.sock")
	service := &Service{
		options: ServiceOptions{
			SocketPath: socket,
			Token:      testToken,
			OwnerUID:   -1,
			OwnerGID:   -1,
			Version:    "test",
		},
		clients: map[*serviceClient]struct{}{},
		done:    make(chan struct{}),
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = service.run()
	}()

	client := NewClient(socket, filepath.Join(directory, "core.token"), "test")
	// The service is started in-process here rather than launched under
	// elevation, so hand the client the token directly.
	client.token = testToken

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err := client.connect(); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !client.Connected() {
		t.Fatal("client never connected to the core service")
	}
	if _, err := client.handshake(); err != nil {
		t.Fatalf("handshake: %v", err)
	}

	t.Cleanup(func() {
		client.Shutdown()
		service.shutdown()
		_ = service.instance.Stop()
		wg.Wait()
		_ = os.Remove(socket)
	})
	return client, socket
}

func TestServiceStartStopRoundTrip(t *testing.T) {
	client := startTestService(t)

	if response, err := client.request(Request{Cmd: CmdPing}); err != nil {
		t.Fatalf("ping: %v", err)
	} else if response.Version != "test" {
		t.Fatalf("expected version handshake, got %q", response.Version)
	}

	if client.Running() {
		t.Fatal("nothing should be running before start")
	}

	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("start: %v", err)
	}
	if !client.Running() {
		t.Fatal("core reported not running after a successful start")
	}

	if err := client.Stop(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if client.Running() {
		t.Fatal("core still running after stop")
	}
}

// TestServiceRejectsBadConfig makes sure a broken profile surfaces as an error
// instead of leaving the service in a half-started state.
func TestServiceRejectsBadConfig(t *testing.T) {
	client := startTestService(t)

	err := client.Start([]byte(`{"outbounds":[{"type":"not-a-real-protocol","tag":"proxy"}]}`))
	if err == nil {
		t.Fatal("expected an error for an unknown outbound type")
	}
	if client.Running() {
		t.Fatal("a failed start must not leave the core running")
	}

	// The service must still accept a good config afterwards.
	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("start after failure: %v", err)
	}
	if !client.Running() {
		t.Fatal("core should be running after the recovery start")
	}
}

// TestServiceStreamsLogs covers the path that feeds the UI's log pane.
func TestServiceStreamsLogs(t *testing.T) {
	client := startTestService(t)

	received := make(chan string, 64)
	client.OnLog(func(_, message string) {
		select {
		case received <- message:
		default:
		}
	})

	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("start: %v", err)
	}

	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("no log lines arrived from the core service")
	}
}

// TestRestartReplacesInstance checks that starting twice does not leak the
// first instance, which would keep its inbound port bound.
func TestRestartReplacesInstance(t *testing.T) {
	client := startTestService(t)

	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("first start: %v", err)
	}
	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("second start: %v", err)
	}
	if !client.Running() {
		t.Fatal("core should be running after the restart")
	}
}

// TestServiceRejectsUnauthenticatedClients is the regression test for the
// privilege boundary: the socket hands arbitrary sing-box configs to a root
// process, so a peer that cannot produce the session token must get nothing.
func TestServiceRejectsUnauthenticatedClients(t *testing.T) {
	_, socket := startTestServiceOnSocket(t)

	cases := []struct {
		name    string
		request Request
	}{
		{"no handshake at all", Request{ID: 1, Cmd: CmdStatus}},
		{"wrong token", Request{ID: 1, Cmd: CmdHello, Token: "not-the-token"}},
		{"empty token", Request{ID: 1, Cmd: CmdHello}},
		{"start before hello", Request{ID: 1, Cmd: CmdStart, Config: []byte(`{}`)}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			conn, err := net.DialTimeout("unix", socket, 2*time.Second)
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer conn.Close()

			if err := json.NewEncoder(conn).Encode(testCase.request); err != nil {
				t.Fatalf("send: %v", err)
			}

			var response Response
			if err := json.NewDecoder(conn).Decode(&response); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if response.OK {
				t.Fatal("the service accepted an unauthenticated request")
			}
			if response.Error != "unauthorized" {
				t.Fatalf("expected an unauthorized error, got %q", response.Error)
			}

			// The connection must be closed rather than left open for a retry.
			_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			if _, err := conn.Read(make([]byte, 1)); err == nil {
				t.Fatal("the service kept an unauthorized connection open")
			}
		})
	}
}

// TestServiceReportsTrafficStats covers the counters that replaced the Clash
// API HTTP listener. They must be readable from inside the process, because the
// listener they replace was an unauthenticated control plane for a root process.
func TestServiceReportsTrafficStats(t *testing.T) {
	client := startTestService(t)

	if _, _, ok := client.Stats(); ok {
		t.Fatal("stats should not be available before the tunnel starts")
	}

	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("start: %v", err)
	}

	// A freshly started instance has moved no bytes, so the useful assertion is
	// that the counters exist and are readable, not that they are non-zero.
	up, down, ok := client.Stats()
	if !ok {
		t.Fatal("stats unavailable while the tunnel is running")
	}
	if up < 0 || down < 0 {
		t.Fatalf("nonsensical counters: up=%d down=%d", up, down)
	}
}

// TestServicePushesStats checks the GUI never has to poll: the core volunteers
// its counters on a timer.
func TestServicePushesStats(t *testing.T) {
	client := startTestService(t)

	received := make(chan struct{}, 1)
	client.OnStats(func(_, _ int64) {
		select {
		case received <- struct{}{}:
		default:
		}
	})

	if err := client.Start(testConfig(t)); err != nil {
		t.Fatalf("start: %v", err)
	}

	select {
	case <-received:
	case <-time.After(10 * time.Second):
		t.Fatal("the core never pushed a stats event")
	}
}

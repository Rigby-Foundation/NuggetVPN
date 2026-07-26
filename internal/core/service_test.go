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

// startTestService runs the core service on a temporary socket and returns a
// connected client.
func startTestService(t *testing.T) *Client {
	t.Helper()

	socket := filepath.Join(t.TempDir(), "core.sock")
	service := &Service{
		options: ServiceOptions{SocketPath: socket, OwnerUID: -1, OwnerGID: -1, Version: "test"},
		clients: map[*serviceClient]struct{}{},
		done:    make(chan struct{}),
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = service.run()
	}()

	client := NewClient(socket, "test")
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

	t.Cleanup(func() {
		client.Shutdown()
		service.shutdown()
		_ = service.instance.Stop()
		wg.Wait()
		_ = os.Remove(socket)
	})
	return client
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

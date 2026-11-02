package plugins

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// When the test executable is copied into a plugin, run a tiny real backend
// instead of the test runner. This exercises pipes, dispatch, and shutdown.
func init() {
	if os.Getenv("NUGGET_PLUGIN_ID") != "com.example.native" || os.Getenv("NUGGET_PLUGIN_API") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	var pending json.RawMessage
	send := func(message wireMessage) { data, _ := json.Marshal(message); fmt.Println(string(data)) }
	for scanner.Scan() {
		var message wireMessage
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(2)
		}
		reply := wireMessage{ID: message.ID, Result: json.RawMessage("null")}
		switch message.Method {
		case "plugin.initialize":
			reply.Result = json.RawMessage(`{"api":1}`)
		case "echo":
			reply.Result = message.Params
		case "host.call":
			pending = message.ID
			send(wireMessage{ID: json.RawMessage(`"host-1"`), Method: "storage.get", Params: json.RawMessage(`{"key":"hello"}`)})
			continue
		case "subscribe":
			pending = message.ID
			send(wireMessage{ID: json.RawMessage(`"host-1"`), Method: "events.subscribe", Params: json.RawMessage(`{"event":"vpn.state"}`)})
			continue
		case "hang":
			continue
		case "crash":
			os.Exit(3)
		case "environment":
			reply.Result, _ = json.Marshal(map[string]string{"secret": os.Getenv("NUGGET_TEST_SECRET"), "data": os.Getenv("NUGGET_PLUGIN_DATA")})
		case "":
			if message.Event != "" {
				send(wireMessage{Event: "received", Data: message.Data})
				continue
			}
			reply.ID, reply.Result, reply.Error = pending, message.Result, message.Error
		default:
			reply.Error = "unknown method"
		}
		send(reply)
	}
	os.Exit(0)
}

func nativePackage(t *testing.T) *Package {
	t.Helper()
	if !NativeAllowed() {
		t.Skip("desktop only")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	if len(binary) > maxEntry {
		t.Fatalf("test executable too large: %d", len(binary))
	}
	name := "bin/backend"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	manifest := Manifest{Format: 1, ID: "com.example.native", Name: "Native", Version: "1.0.0", Backend: &Backend{API: 1, Executables: map[string]string{runtime.GOOS + "/" + runtime.GOARCH: name}}}
	data, _ := json.Marshal(manifest)
	files := map[string][]byte{ManifestName: data, name: binary}
	present := map[string]bool{ManifestName: true, name: true}
	manifest, err = ParseManifest(data, present)
	if err != nil {
		t.Fatal(err)
	}
	return &Package{Manifest: manifest, Files: files}
}

func TestNativeBackendRPCAndRevocation(t *testing.T) {
	store := NewStore(t.TempDir())
	pkg := nativePackage(t)
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NUGGET_TEST_SECRET", "must-not-be-inherited")
	events := make(chan json.RawMessage, 1)
	host := NewNativeHost(func(id, method string, raw json.RawMessage) (any, error) {
		if id != pkg.Manifest.ID {
			return nil, fmt.Errorf("wrong identity")
		}
		if method == "storage.get" {
			return "hello from host", nil
		}
		if method == "events.subscribe" {
			return nil, nil
		}
		return nil, fmt.Errorf("unknown method")
	}, func(id, name string, data json.RawMessage) {
		select {
		case events <- data:
		default:
		}
	})
	defer host.Close()
	host.Sync(store, store.List())
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	result, err := host.Call(ctx, pkg.Manifest.ID, "echo", json.RawMessage(`{"hello":"native"}`))
	if err != nil || string(result) != `{"hello":"native"}` {
		t.Fatalf("echo %s: %v (%s)", result, err, host.Status(pkg.Manifest.ID))
	}
	result, err = host.Call(ctx, pkg.Manifest.ID, "host.call", nil)
	if err != nil || string(result) != `"hello from host"` {
		t.Fatalf("duplex host call %s: %v", result, err)
	}
	result, err = host.Call(ctx, pkg.Manifest.ID, "environment", nil)
	if err != nil || strings.Contains(string(result), "must-not-be-inherited") {
		t.Fatalf("environment %s: %v", result, err)
	}
	var env map[string]string
	_ = json.Unmarshal(result, &env)
	if env["data"] == "" {
		t.Fatal("no private data directory")
	}
	if _, err := host.Call(ctx, pkg.Manifest.ID, "subscribe", nil); err != nil {
		t.Fatal(err)
	}
	host.Publish("vpn.state", "connected", func(id string) bool { return true })
	select {
	case event := <-events:
		if string(event) != `"connected"` {
			t.Fatal(string(event))
		}
	case <-ctx.Done():
		t.Fatal("event not delivered")
	}
	short, stop := context.WithTimeout(ctx, 30*time.Millisecond)
	_, err = host.Call(short, pkg.Manifest.ID, "hang", nil)
	stop()
	if err == nil {
		t.Fatal("call did not time out")
	}
	// The running process is stopped when any installed file changes.
	if err := os.WriteFile(filepath.Join(store.pluginDir(pkg.Manifest.ID), "extra.txt"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	host.Sync(store, store.List())
	if _, err := host.Call(ctx, pkg.Manifest.ID, "echo", nil); err == nil {
		t.Fatal("revoked backend still callable")
	}
}

func TestNativeCrashDoesNotRestartAndClosePreventsStarts(t *testing.T) {
	store := NewStore(t.TempDir())
	pkg := nativePackage(t)
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	host := NewNativeHost(func(string, string, json.RawMessage) (any, error) { return nil, nil }, nil)
	defer host.Close()
	host.Sync(store, store.List())
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if _, err := host.Call(ctx, pkg.Manifest.ID, "crash", nil); err == nil {
		t.Fatal("crash succeeded")
	}
	host.Sync(store, store.List())
	if _, err := host.Call(ctx, pkg.Manifest.ID, "echo", nil); err == nil {
		t.Fatal("crashed process restarted")
	}
	host.Stop(pkg.Manifest.ID)
	host.Sync(store, store.List())
	if _, err := host.Call(ctx, pkg.Manifest.ID, "echo", nil); err != nil {
		t.Fatal("explicit restart failed:", err)
	}
	host.Close()
	host.Sync(store, store.List())
	if _, err := host.Call(ctx, pkg.Manifest.ID, "echo", nil); err == nil {
		t.Fatal("host restarted after close")
	}
}

func TestNativeManifestValidationAndNoLegacyAutoApproval(t *testing.T) {
	pkg := nativePackage(t)
	files := map[string]bool{}
	for file := range pkg.Files {
		files[file] = true
	}
	for _, backend := range []*Backend{
		{API: 2, Executables: pkg.Manifest.Backend.Executables},
		{API: 1, Executables: map[string]string{"android/arm64": "bin/backend"}},
		{API: 1, Executables: map[string]string{"linux/arm64": "../backend"}},
		{API: 1, Executables: map[string]string{"linux/arm64": "missing"}},
		{API: 1, Executables: map[string]string{"windows/amd64": "bin/backend"}},
	} {
		manifest := pkg.Manifest
		manifest.Backend = backend
		data, _ := json.Marshal(manifest)
		if _, err := ParseManifest(data, files); err == nil {
			t.Fatalf("accepted invalid backend %+v", backend)
		}
	}
	store := NewStore(t.TempDir())
	if err := store.Install(pkg); err != nil {
		t.Fatal(err)
	}
	states := store.readState()
	state := states[pkg.Manifest.ID]
	state.Checksum = ""
	states[pkg.Manifest.ID] = state
	if err := store.writeState(states); err != nil {
		t.Fatal(err)
	}
	plugin, _ := store.Get(pkg.Manifest.ID)
	if plugin.State.Enabled || !plugin.State.ApprovalRequired {
		t.Fatal("native code trusted without approval")
	}
}

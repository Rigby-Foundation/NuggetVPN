package app

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// bridgePath is the command table, relative to this package.
var bridgePath = filepath.Join("..", "..", "frontend", "src", "lib", "backend.ts")

// bridgeEntry is one row of the command table in frontend/src/lib/backend.ts.
type bridgeEntry struct {
	method string
	args   int
}

// commandTablePattern matches `method: "Name", args: [...]` entries.
var commandTablePattern = regexp.MustCompile(`method:\s*"(\w+)",\s*args:\s*\[([^\]]*)\]`)

func readBridge(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile(bridgePath)
	if err != nil {
		t.Fatalf("read bridge: %v", err)
	}
	return string(source)
}

func parseBridgeCommands(t *testing.T) []bridgeEntry {
	t.Helper()

	matches := commandTablePattern.FindAllStringSubmatch(readBridge(t), -1)
	if len(matches) == 0 {
		t.Fatal("no commands found in the bridge table; did its format change?")
	}

	entries := make([]bridgeEntry, 0, len(matches))
	for _, match := range matches {
		args := 0
		if trimmed := strings.TrimSpace(match[2]); trimmed != "" {
			args = strings.Count(trimmed, ",") + 1
		}
		entries = append(entries, bridgeEntry{method: match[1], args: args})
	}
	return entries
}

// TestBridgeCommandTableMatchesApp keeps the frontend's command table honest.
// The bridge calls Go by name, so a renamed or re-signatured App method would
// otherwise only fail at runtime, in whichever screen happens to use it.
func TestBridgeCommandTableMatchesApp(t *testing.T) {
	appType := reflect.TypeOf(&App{})

	for _, entry := range parseBridgeCommands(t) {
		method, ok := appType.MethodByName(entry.method)
		if !ok {
			t.Errorf("bridge references App.%s, which does not exist", entry.method)
			continue
		}
		// Subtract the receiver from the input count.
		want := method.Type.NumIn() - 1
		if want != entry.args {
			t.Errorf("bridge passes %d args to App.%s, which takes %d",
				entry.args, entry.method, want)
		}
	}
}

// TestServiceFQNMatchesGo checks the name the frontend calls the service by.
//
// Wails builds it as `<package path>.<type>` from reflection, and this test now
// derives the expectation the same way. It could not do that while App lived in
// package main: there, reflection reports "main" in the shipped binary and the
// full import path inside a test binary, so the two never agreed and a wrong
// constant shipped — every call failing with "unknown bound method name" while
// the suite stayed green. Out here both report this package, so a mismatch is a
// test failure rather than a runtime one.
func TestServiceFQNMatchesGo(t *testing.T) {
	appType := reflect.TypeOf(&App{}).Elem()

	want := `const SERVICE = "` + appType.PkgPath() + "." + appType.Name() + `";`
	if !strings.Contains(readBridge(t), want) {
		t.Errorf("bridge SERVICE constant is wrong; expected %s", want)
	}
}

// TestBoundMethodsAreReachable flags exported App methods the UI cannot call,
// so a new backend method is not silently left unwired.
func TestBoundMethodsAreReachable(t *testing.T) {
	// Lifecycle hooks are called by Wails, not the frontend.
	internal := map[string]bool{
		"ServiceStartup":  true,
		"ServiceShutdown": true,
		"ServiceName":     true,
	}

	wired := map[string]bool{}
	for _, entry := range parseBridgeCommands(t) {
		wired[entry.method] = true
	}

	appType := reflect.TypeOf(&App{})
	for i := range appType.NumMethod() {
		name := appType.Method(i).Name
		if internal[name] || wired[name] {
			continue
		}
		t.Errorf("App.%s is bound but no bridge command maps to it", name)
	}
}

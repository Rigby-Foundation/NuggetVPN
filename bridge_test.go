package main

import (
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// bridgeEntry is one row of the command table in frontend/src/lib/backend.ts.
type bridgeEntry struct {
	method string
	args   int
}

// commandTablePattern matches `method: "Name", args: [...]` entries.
var commandTablePattern = regexp.MustCompile(`method:\s*"(\w+)",\s*args:\s*\[([^\]]*)\]`)

func parseBridgeCommands(t *testing.T) []bridgeEntry {
	t.Helper()

	source, err := os.ReadFile("frontend/src/lib/backend.ts")
	if err != nil {
		t.Fatalf("read bridge: %v", err)
	}

	matches := commandTablePattern.FindAllStringSubmatch(string(source), -1)
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

// TestServiceFQNMatchesModulePath guards the service name the bridge builds its
// call strings from; it must track the module path in go.mod.
func TestServiceFQNMatchesModulePath(t *testing.T) {
	bridge, err := os.ReadFile("frontend/src/lib/backend.ts")
	if err != nil {
		t.Fatalf("read bridge: %v", err)
	}
	goMod, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}

	var modulePath string
	for _, line := range strings.Split(string(goMod), "\n") {
		if after, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			modulePath = strings.TrimSpace(after)
			break
		}
	}
	if modulePath == "" {
		t.Fatal("could not read the module path from go.mod")
	}

	want := `const SERVICE = "` + modulePath + `.App";`
	if !strings.Contains(string(bridge), want) {
		t.Errorf("bridge SERVICE constant does not match the module path; expected %s", want)
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

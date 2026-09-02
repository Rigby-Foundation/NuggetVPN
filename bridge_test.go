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

// TestServiceFQNIsMainPackage guards the service name the bridge builds its call
// strings from.
//
// Wails derives the name from reflect.Type.PkgPath(), which for a type declared
// in a `package main` binary is the literal "main" — not the module path. This
// test hardcodes that rather than deriving it from reflection on purpose: a
// test binary keeps the full import path for the package under test, so
// reflect.TypeOf(&App{}).Elem().PkgPath() returns
// "github.com/Rigby-Foundation/NuggetVPN" here and "main" in the shipped app.
// The earlier version of this test derived the expected value from go.mod, so
// it passed happily while every call from the real app failed with "unknown
// bound method name".
//
// If App is ever moved out of package main, this becomes the real import path
// and reflection becomes trustworthy again.
func TestServiceFQNIsMainPackage(t *testing.T) {
	bridge, err := os.ReadFile("frontend/src/lib/backend.ts")
	if err != nil {
		t.Fatalf("read bridge: %v", err)
	}

	typeName := reflect.TypeOf(&App{}).Elem().Name()
	want := `const SERVICE = "main.` + typeName + `";`
	if !strings.Contains(string(bridge), want) {
		t.Errorf("bridge SERVICE constant is wrong; expected %s", want)
	}

	// The module path must not appear in the constant: that is the exact
	// mistake this test exists to prevent.
	if strings.Contains(string(bridge), `const SERVICE = "github.com/`) {
		t.Error("bridge SERVICE uses the module path; a package main binary reports \"main\"")
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

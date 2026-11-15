package app

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

var bridgePath = filepath.Join("..", "..", "frontend", "src", "lib", "window.ts")

func readBridge(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile(bridgePath)
	if os.IsNotExist(err) {
		// The frontend rebuild is committed separately from the core migration.
		// Keep the service-name check usable with the previous frontend too.
		source, err = os.ReadFile(filepath.Join("..", "..", "frontend", "src", "lib", "backend.ts"))
	}
	if err != nil {
		t.Fatalf("read window bridge: %v", err)
	}
	return string(source)
}

// The rebuilt frontend currently binds only its window actions directly.
func TestWindowActionsMatchApp(t *testing.T) {
	if _, err := os.Stat(bridgePath); os.IsNotExist(err) {
		t.Skip("window actions are checked when the separate frontend migration is present")
	}
	source := readBridge(t)
	actionType := regexp.MustCompile(`type WindowAction\s*=([^;]+);`).FindStringSubmatch(source)
	if len(actionType) != 2 {
		t.Fatal("window action type is missing")
	}
	actions := regexp.MustCompile(`"([A-Za-z]+)"`).FindAllStringSubmatch(actionType[1], -1)
	if len(actions) == 0 {
		t.Fatal("no window actions found")
	}
	appType := reflect.TypeOf(&App{})
	for _, action := range actions {
		method, ok := appType.MethodByName(action[1])
		if !ok {
			t.Errorf("missing App.%s", action[1])
			continue
		}
		if method.Type.NumIn() != 1 {
			t.Errorf("App.%s requires arguments the window bridge does not send", action[1])
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

func TestLegacyCoreSwitchingIsNotBound(t *testing.T) {
	appType := reflect.TypeOf(&App{})
	for _, name := range []string{"ListCores", "SetCore"} {
		if _, ok := appType.MethodByName(name); ok {
			t.Errorf("obsolete multi-core API App.%s remains bound", name)
		}
	}
}

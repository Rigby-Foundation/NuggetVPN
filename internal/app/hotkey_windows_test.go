//go:build windows

package app

import (
	"strings"
	"testing"
)

// TestRegisterHotkey registers a real system-wide shortcut, replaces it and
// removes it. The combination is one nothing else uses.
func TestRegisterHotkey(t *testing.T) {
	a := &App{}
	if err := a.registerHotkey("Ctrl+Alt+Shift+F24"); err != nil {
		// A service session — a CI runner — has no interactive desktop, and
		// Windows refuses hotkeys there for reasons other than a conflict.
		if !strings.Contains(err.Error(), "already used") {
			t.Skipf("no desktop to register a hotkey on: %v", err)
		}
		t.Fatalf("register: %v", err)
	}
	if err := a.registerHotkey("Ctrl+Alt+Shift+F23"); err != nil {
		t.Fatalf("replace: %v", err)
	}
	if err := a.registerHotkey(""); err != nil {
		t.Fatalf("remove: %v", err)
	}
}

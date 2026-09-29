package app

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------

// hotkey is a parsed shortcut: modifier flags and a key, in the platform's
// own codes (see hotkey_windows.go).
type hotkey struct {
	ctrl, alt, shift, super bool
	key                     string
}

// parseHotkey reads shortcuts written as the settings screen records them:
// "Ctrl+Alt+V", "Shift+Super+F9". At least one modifier is required — a bare
// letter as a system-wide shortcut would take that letter from every app.
func parseHotkey(spec string) (hotkey, error) {
	var result hotkey
	parts := strings.Split(strings.TrimSpace(spec), "+")
	for index, part := range parts {
		part = strings.TrimSpace(part)
		if index == len(parts)-1 {
			result.key = strings.ToUpper(part)
			break
		}
		switch strings.ToLower(part) {
		case "ctrl", "control":
			result.ctrl = true
		case "alt", "option":
			result.alt = true
		case "shift":
			result.shift = true
		case "super", "win", "meta", "cmd", "command":
			result.super = true
		default:
			return hotkey{}, fmt.Errorf("unknown modifier %q", part)
		}
	}
	if !result.ctrl && !result.alt && !result.super {
		return hotkey{}, fmt.Errorf("a shortcut needs Ctrl, Alt or the Windows key")
	}
	if _, ok := virtualKey(result.key); !ok {
		return hotkey{}, fmt.Errorf("unsupported key %q", result.key)
	}
	return result, nil
}

// virtualKey maps a key name to its Windows virtual-key code: letters,
// digits, and F1 to F24.
func virtualKey(name string) (uint32, bool) {
	if len(name) == 1 {
		char := name[0]
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			return uint32(char), true
		}
		return 0, false
	}
	var number int
	if _, err := fmt.Sscanf(name, "F%d", &number); err == nil && number >= 1 && number <= 24 && name == fmt.Sprintf("F%d", number) {
		return uint32(0x70 + number - 1), true
	}
	return 0, false
}

// SetGlobalShortcut registers the shortcut that connects and disconnects from
// anywhere, and saves it. An empty spec removes it. It fails, saving nothing,
// when the system refuses — usually because another app holds that shortcut.
func (a *App) SetGlobalShortcut(spec string) (string, error) {
	spec = strings.TrimSpace(spec)
	if spec != "" {
		if _, err := parseHotkey(spec); err != nil {
			return "", err
		}
	}
	if err := a.registerHotkey(spec); err != nil {
		return "", err
	}
	settings := a.GetSettings()
	settings.GlobalShortcut = spec
	if _, err := a.SaveSettings(settings); err != nil {
		return "", err
	}
	return spec, nil
}

// GlobalShortcutSupported reports whether this system can have a global
// shortcut, so the settings screen only offers it where it works.
func (a *App) GlobalShortcutSupported() bool {
	return hotkeysSupported()
}

// toggleFromShortcut connects to the last selection, or disconnects.
func (a *App) toggleFromShortcut() {
	a.mu.Lock()
	state := a.state
	a.mu.Unlock()
	if state.Status == StatusConnected || state.Status == StatusConnecting || state.Blocked {
		if _, err := a.Disconnect(); err != nil {
			a.appendLog("Shortcut: " + err.Error())
		}
		return
	}
	_, settings := a.snapshot()
	selection := settings.LastSelection
	if selection == nil {
		a.appendLog("Shortcut: pick a server once in the app first")
		return
	}
	if _, err := a.Connect(selection.Domain, selection.Mode, selection.ProfileID); err != nil {
		a.appendLog("Shortcut: " + err.Error())
	}
}

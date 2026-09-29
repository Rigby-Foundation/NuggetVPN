//go:build !windows

package app

import "errors"

// registerHotkey is only implemented on Windows. Elsewhere a system-wide
// shortcut needs the main thread, which the window toolkit owns.
func (a *App) registerHotkey(spec string) error {
	if spec == "" {
		return nil
	}
	return errors.New("a global shortcut is only available on Windows for now")
}

// hotkeysSupported reports whether a global shortcut can be registered.
func hotkeysSupported() bool { return false }

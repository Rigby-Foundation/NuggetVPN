// Package autostart registers the app to launch when the user logs in.
//
// Each platform has its own mechanism — the Run key on Windows, a launch
// agent on macOS, an XDG autostart entry on Linux — and every one of them can
// also be changed from outside the app (Task Manager's startup tab, System
// Settings' login items). So the state is always read back from the system,
// never assumed from what was last saved.
package autostart

import (
	"os"
	"path/filepath"
)

// Flag is passed to the app when the system starts it at login, so it can
// start without putting a window in the user's face.
const Flag = "--autostart"

// Set turns launching at login on or off.
func Set(enabled bool) error {
	if !enabled {
		return disable()
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	// A symlink would break the moment it is moved; register the real file.
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return enable(executable)
}

// Enabled reports whether the system will launch the app at login.
func Enabled() bool {
	return enabled()
}

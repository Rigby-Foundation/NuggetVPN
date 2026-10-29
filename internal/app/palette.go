package app

import (
	"encoding/json"
	"regexp"
)

// GetSystemPalette returns the system's own colour palette, which the
// "system" theme follows: Android 12's Material You tones, or a desktop
// wallpaper colour. Null when the platform cannot provide either.
func (a *App) GetSystemPalette() json.RawMessage {
	palette := systemPalette()
	if palette == "" || !json.Valid([]byte(palette)) {
		return json.RawMessage("null")
	}
	return json.RawMessage(palette)
}

var hexColor = regexp.MustCompile("^#[0-9a-fA-F]{6}$")

// SetSystemBars colours the phone's status and navigation bars like the
// page, as #RRGGBB, with dark icons when light is set. Nothing happens where
// there are no such bars.
func (a *App) SetSystemBars(color string, light bool) {
	if hexColor.MatchString(color) {
		setSystemBars(color, light)
	}
}

// InstalledApp is an app on the phone, for Applications rules.
type InstalledApp struct {
	Package string `json:"package"`
	Label   string `json:"label"`
	System  bool   `json:"system"`
	// Running is true for a program running now; on a computer, one found
	// only that way (a portable app, one nothing installed) is listed too.
	Running bool `json:"running,omitempty"`
	// Parent is the app this one is built into (Teams' ModuleHost, an
	// Electron app's helpers), by its Package; "" for a top-level app.
	Parent string `json:"parent,omitempty"`
}

// ListInstalledApps lists the installed apps a routing rule can name: by
// package on Android, by program path on macOS, Windows and Linux (see
// installedapps_*.go). Empty on iOS, which routes the whole device.
func (a *App) ListInstalledApps() []InstalledApp {
	return installedApps()
}

// GetAppIcon is an installed app's icon as a PNG data URL; "" when unknown.
func (a *App) GetAppIcon(packageName string) string {
	return appIcon(packageName)
}

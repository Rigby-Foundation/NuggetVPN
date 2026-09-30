package app

import (
	"encoding/json"
	"regexp"
)

// GetSystemPalette returns the system's own colour palette, which the
// "system" theme follows where there is one: Android 12's Material You,
// taken from the wallpaper. Null elsewhere.
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
}

// ListInstalledApps lists the apps that can use the network, where the
// system says (Android). Empty elsewhere, where programs are named by file.
func (a *App) ListInstalledApps() []InstalledApp {
	return installedApps()
}

// GetAppIcon is an installed app's icon as a PNG data URL; "" when unknown.
func (a *App) GetAppIcon(packageName string) string {
	return appIcon(packageName)
}

//go:build !android

package app

import "github.com/Rigby-Foundation/NuggetVPN/internal/wallpaper"

// onAndroid is true in the Android build.
const onAndroid = false

func (a *App) startPlatform() {}

// Desktop palettes use a colour extracted from the current wallpaper.
func systemPalette() string { return wallpaper.Palette() }

func setSystemBars(string, bool) {}

// installedApps on a computer: the programs the system lists as installed,
// each by the path a routing rule takes (see installedapps_*.go).
func installedApps() []InstalledApp { return desktopApps() }

func appIcon(path string) string { return desktopAppIcon(path) }

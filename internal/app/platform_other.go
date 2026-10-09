//go:build !android

package app

// onAndroid is true in the Android build.
const onAndroid = false

func (a *App) startPlatform() {}

// systemPalette is Android's Material You colours; there are none here.
func systemPalette() string { return "" }

func setSystemBars(string, bool) {}

// installedApps on a computer: the programs the system lists as installed,
// each by the path a routing rule takes (see installedapps_*.go).
func installedApps() []InstalledApp { return desktopApps() }

func appIcon(path string) string { return desktopAppIcon(path) }

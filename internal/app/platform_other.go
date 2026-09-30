//go:build !android

package app

// onAndroid is true in the Android build.
const onAndroid = false

func (a *App) startPlatform() {}

// systemPalette is Android's Material You colours; there are none here.
func systemPalette() string { return "" }

func setSystemBars(string, bool) {}

func installedApps() []InstalledApp { return []InstalledApp{} }

func appIcon(string) string { return "" }

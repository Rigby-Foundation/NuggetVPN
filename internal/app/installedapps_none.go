//go:build (!android && !windows && !darwin && !linux) || ios

package app

// desktopApps: nothing to list here; iOS routes the whole device.
func desktopApps() []InstalledApp { return []InstalledApp{} }

func desktopAppIcon(string) string { return "" }

//go:build android

package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/android"
)

// onAndroid is true in the Android build.
const onAndroid = true

// startPlatform wires what only Android has: the system can take the VPN
// away, when another VPN app starts or the user turns it off in Settings.
func (a *App) startPlatform() {
	android.OnRevoked(func() {
		a.appendLog("Android turned the VPN off")
		_, _ = a.Disconnect()
		a.setState(ConnectionState{Status: StatusError, Error: "Android turned the VPN off. Another VPN app may have started."})
	})
	android.OnLink(func(link string) { ReceiveLaunchArgs(a, []string{link}) })
}

// systemPalette is the device's Material You colours, as JSON.
func systemPalette() string { return android.SystemPalette() }

// setSystemBars colours the status and navigation bars on Android.
func setSystemBars(color string, light bool) { android.SetSystemBars(color, light) }

func installedApps() []InstalledApp {
	apps := []InstalledApp{}
	for _, app := range android.InstalledApps() {
		apps = append(apps, InstalledApp{Package: app.Package, Label: app.Label, System: app.System})
	}
	return apps
}

func appIcon(packageName string) string { return android.AppIcon(packageName) }

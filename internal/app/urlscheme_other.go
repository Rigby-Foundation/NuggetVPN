//go:build !windows

package app

// registerURLScheme is a no-op here: macOS reads the scheme from the app
// bundle's Info.plist, and Linux from the installed .desktop file.
func registerURLScheme() {}

//go:build android

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// On Android the app is a shared library the Java host loads; main is not
// called by the system, so it is registered to be started when Java is ready.
func init() {
	application.RegisterAndroidMain(main)
}

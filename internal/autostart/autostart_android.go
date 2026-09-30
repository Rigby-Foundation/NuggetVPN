//go:build android

package autostart

import "errors"

// Android starts apps itself; an app cannot add itself to login.
var errAndroid = errors.New("launching at startup is not available on Android")

func enable(string) error { return errAndroid }

func disable() error { return nil }

func enabled() bool { return false }

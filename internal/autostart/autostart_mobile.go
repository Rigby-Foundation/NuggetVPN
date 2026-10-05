//go:build android || ios

package autostart

import "errors"

// Mobile platforms start apps themselves; an app cannot add itself to login.
var errMobile = errors.New("launching at startup is not available on mobile")

func enable(string) error { return errMobile }

func disable() error { return nil }

func enabled() bool { return false }

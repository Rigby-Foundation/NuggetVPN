//go:build linux && !android

package app

import "testing"

func TestExecProgram(t *testing.T) {
	for exec, want := range map[string]string{
		"firefox %u":                     "firefox",
		`"/opt/Telegram/Telegram" -- %u`: "/opt/Telegram/Telegram",
		"env GDK_BACKEND=x11 discord":    "discord",
		"/usr/bin/flatpak run --branch=stable --arch=x86_64 com.spotify.Client @@u %U @@": "com.spotify.Client",
		"": "",
	} {
		if got := execProgram(exec); got != want {
			t.Errorf("execProgram(%q) = %q, want %q", exec, got, want)
		}
	}
}

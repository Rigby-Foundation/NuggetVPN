package app

import "testing"

func TestWithRunning(t *testing.T) {
	listed := []InstalledApp{{Package: "firefox", Label: "Firefox"}, {Package: "/opt/x/x", Label: "X"}}
	running := []InstalledApp{
		{Package: "/usr/lib/firefox/firefox", Label: "firefox", System: true},
		{Package: "/opt/x/x", Label: "x"},
		{Package: "/home/u/Apps/Portable.AppImage", Label: "Portable.AppImage"},
	}
	got := withRunning(listed, running)
	if len(got) != 3 || !got[0].Running || !got[1].Running || got[2].Package != "/home/u/Apps/Portable.AppImage" || !got[2].Running {
		t.Fatalf("%+v", got)
	}
}

//go:build darwin && !ios

package app

import (
	"strings"
	"testing"
)

func TestDesktopAppsListsBundlesWithIcons(t *testing.T) {
	apps := desktopApps()
	if len(apps) == 0 {
		t.Skip("no applications on this machine")
	}
	var finder bool
	for _, app := range apps {
		if !strings.HasSuffix(app.Package, ".app") || app.Label == "" {
			t.Fatalf("not a bundle: %+v", app)
		}
		if app.Label == "Safari" || app.Label == "App Store" {
			finder = true
			if icon := desktopAppIcon(app.Package); !strings.HasPrefix(icon, "data:image/png;base64,") {
				t.Fatalf("no icon for %s", app.Package)
			}
		}
	}
	if !finder {
		t.Fatalf("Safari or App Store missing from %d apps", len(apps))
	}
	t.Logf("%d apps, first %+v", len(apps), apps[0])
}

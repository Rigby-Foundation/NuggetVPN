//go:build darwin && !ios

package app

import (
	"os"
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

func TestDesktopAppsListEmbeddedApps(t *testing.T) {
	apps := desktopApps()
	byParent := map[string][]string{}
	for _, app := range apps {
		if app.Parent != "" {
			byParent[app.Parent] = append(byParent[app.Parent], app.Label)
		}
	}
	teams := "/Applications/Microsoft Teams.app"
	if _, err := os.Stat(teams); err == nil {
		got := strings.Join(byParent[teams], ", ")
		for _, want := range []string{"Microsoft Teams ModuleHost", "vcxpc"} {
			if !strings.Contains(got, want) {
				t.Errorf("%s not listed inside Teams: %s", want, got)
			}
		}
	}
	for parent, children := range byParent {
		seen := map[string]bool{}
		for _, child := range children {
			if seen[child] {
				t.Errorf("%s listed twice inside %s", child, parent)
			}
			seen[child] = true
		}
	}
	t.Logf("%d apps, %d with embedded apps", len(apps), len(byParent))
	if chrome := byParent["/Applications/Google Chrome.app"]; len(chrome) > 0 {
		t.Logf("Chrome: %d embedded, e.g. %v", len(chrome), chrome[:min(3, len(chrome))])
	}
}

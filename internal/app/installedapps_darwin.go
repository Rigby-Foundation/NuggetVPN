//go:build darwin && !ios

package app

import (
	"os"
	"path/filepath"
	"strings"
)

// desktopApps lists the .app bundles in the usual Applications folders, one
// level down (Utilities included). An app is chosen by its bundle path, which
// the routing rule resolves to every executable inside it.
func desktopApps() []InstalledApp {
	home, _ := os.UserHomeDir()
	folders := []struct {
		dir    string
		system bool
	}{
		{"/Applications", false},
		{"/Applications/Utilities", false},
		{filepath.Join(home, "Applications"), false},
		{"/System/Applications", true},
		{"/System/Applications/Utilities", true},
	}
	apps := []InstalledApp{}
	for _, folder := range folders {
		entries, err := os.ReadDir(folder.dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if !strings.HasSuffix(name, ".app") {
				continue
			}
			apps = append(apps, InstalledApp{
				Package: filepath.Join(folder.dir, name),
				Label:   strings.TrimSuffix(name, ".app"),
				System:  folder.system,
			})
		}
	}
	return sortApps(apps)
}

// desktopAppIcon is the icon Finder shows for the bundle.
func desktopAppIcon(path string) string {
	if !filepath.IsAbs(path) {
		return ""
	}
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return cachedFileIcon(path)
}

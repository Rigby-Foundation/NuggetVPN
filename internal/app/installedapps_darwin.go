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
			bundle := filepath.Join(folder.dir, name)
			apps = append(apps, InstalledApp{
				Package: bundle,
				Label:   strings.TrimSuffix(name, ".app"),
				System:  folder.system,
			})
			apps = append(apps, embeddedApps(bundle, folder.system)...)
		}
	}
	return sortApps(apps)
}

// embeddedSuffixes are the bundles an app carries that run as processes of
// their own: helper apps, XPC services, extensions.
var embeddedSuffixes = []string{".app", ".xpc", ".appex"}

// maxEmbeddedDirs bounds the walk through one app's bundle.
const maxEmbeddedDirs = 600

// embeddedApps lists the apps built into a bundle — Teams' ModuleHost and
// WebView in Helpers, its call service in XPCServices, an Electron app's
// helpers in Frameworks — so one can be routed on its own. A framework's
// versions other than Current are skipped (they are older copies of the
// same helpers), and a bundle found is not looked inside.
func embeddedApps(bundle string, system bool) []InstalledApp {
	var found []InstalledApp
	seen := map[string]bool{}
	queue := []string{filepath.Join(bundle, "Contents")}
	for visited := 0; len(queue) > 0 && visited < maxEmbeddedDirs; visited++ {
		dir := queue[0]
		queue = queue[1:]
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		current := ""
		if filepath.Base(dir) == "Versions" {
			current, _ = os.Readlink(filepath.Join(dir, "Current"))
		}
		for _, entry := range entries {
			name := entry.Name()
			path := filepath.Join(dir, name)
			if !entry.IsDir() {
				continue
			}
			if current != "" && name != current {
				continue
			}
			suffix := ""
			for _, candidate := range embeddedSuffixes {
				if strings.HasSuffix(name, candidate) {
					suffix = candidate
				}
			}
			if suffix == "" {
				// Not where code lives: resources, headers, signatures.
				switch name {
				case "Resources", "Headers", "Modules", "_CodeSignature", "_MASReceipt", "Assets.car":
					continue
				}
				queue = append(queue, path)
				continue
			}
			label := strings.TrimSuffix(name, suffix)
			if seen[label] {
				continue
			}
			seen[label] = true
			found = append(found, InstalledApp{Package: path, Label: label, System: system, Parent: bundle})
		}
	}
	return found
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

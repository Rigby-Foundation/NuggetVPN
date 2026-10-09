package app

import (
	"sort"
	"strings"
)

// sortApps orders a listing by name, ignoring case, and drops a path listed
// twice (an app found in two places by the same path).
func sortApps(apps []InstalledApp) []InstalledApp {
	seen := map[string]bool{}
	unique := apps[:0]
	for _, app := range apps {
		key := strings.ToLower(app.Package)
		if app.Package == "" || app.Label == "" || seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, app)
	}
	sort.SliceStable(unique, func(i, j int) bool {
		return strings.ToLower(unique[i].Label) < strings.ToLower(unique[j].Label)
	})
	return unique
}

// cachedFileIcon is fileIcon through the same cache as GetFileIcons.
func cachedFileIcon(path string) string {
	if cached, ok := fileIconCache.Load(path); ok {
		return cached.(string)
	}
	icon := fileIcon(path)
	fileIconCache.Store(path, icon)
	return icon
}

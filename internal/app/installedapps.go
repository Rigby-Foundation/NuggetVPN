package app

import (
	"os"
	"path/filepath"
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

// withRunning marks the listed apps that are running and adds the running
// programs nothing lists, so a portable app, or one that registered itself
// nowhere, can be picked while it runs. A program matches a listed app by
// path, or by file name where the listing names programs (Linux). This app
// itself is left out.
func withRunning(listed, running []InstalledApp) []InstalledApp {
	self, _ := os.Executable()
	key := func(path string) string { return strings.ToLower(filepath.Clean(path)) }
	byPath := map[string]int{}
	byName := map[string]int{}
	for index, app := range listed {
		byPath[key(app.Package)] = index
		byName[strings.ToLower(filepath.Base(app.Package))] = index
	}
	for _, program := range running {
		if self != "" && key(program.Package) == key(self) {
			continue
		}
		if index, ok := byPath[key(program.Package)]; ok {
			listed[index].Running = true
			continue
		}
		if index, ok := byName[strings.ToLower(filepath.Base(program.Package))]; ok && !filepath.IsAbs(listed[index].Package) {
			listed[index].Running = true
			continue
		}
		program.Running = true
		byPath[key(program.Package)] = len(listed)
		listed = append(listed, program)
	}
	return listed
}

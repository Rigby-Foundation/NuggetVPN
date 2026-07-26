package sbconfig

import (
	"os"
	"path/filepath"
	"strings"
)

// maxBundleDirs bounds the Frameworks walk so a pathological bundle cannot
// stall config generation.
const maxBundleDirs = 2000

// expandProcessNames turns the user's app selection into the process names
// sing-box matches against. Electron and Chromium apps spawn helper processes
// whose traffic must be routed alongside the main binary, so the helper name
// variants are included too.
func expandProcessNames(apps []string) []string {
	var names []string
	for _, entry := range apps {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}

		fileName := trimmed
		if index := strings.LastIndexAny(trimmed, `/\`); index >= 0 {
			fileName = strings.TrimSpace(trimmed[index+1:])
		}
		if fileName == "" {
			continue
		}
		names = append(names, fileName)

		base := strings.TrimSuffix(fileName, ".app")
		base = strings.TrimSuffix(base, ".exe")
		if base != fileName {
			names = append(names, base)
		}
		if base == "" {
			continue
		}
		for _, suffix := range []string{
			" Helper",
			" Helper (Renderer)",
			" Helper (GPU)",
			" Helper (Plugin)",
			" Helper (Zygote)",
		} {
			names = append(names, base+suffix)
		}
	}
	return dedupe(names)
}

// extractProcessPaths resolves selected .app bundles down to the executables
// inside them, which is what sing-box's process_path rule matches.
func extractProcessPaths(apps []string) []string {
	var paths []string
	seen := map[string]bool{}

	push := func(path string) {
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		paths = append(paths, path)
	}

	for _, entry := range apps {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" || !strings.ContainsAny(trimmed, `/\`) {
			continue
		}

		if !strings.HasSuffix(trimmed, ".app") {
			push(trimmed)
			continue
		}

		push(trimmed)
		bundleName := strings.TrimSuffix(filepath.Base(trimmed), ".app")
		if bundleName != "" {
			push(filepath.Join(trimmed, "Contents", "MacOS", bundleName))
		}
		for _, path := range collectBundleExecutables(trimmed) {
			push(path)
		}
	}
	return paths
}

// collectBundleExecutables lists every executable in Contents/MacOS plus the
// nested .app bundles that live under Contents/Frameworks.
func collectBundleExecutables(bundlePath string) []string {
	var results []string
	results = append(results, collectMacOSExecutables(bundlePath)...)

	queue := []string{filepath.Join(bundlePath, "Contents", "Frameworks")}
	visited := 0

	for len(queue) > 0 && visited < maxBundleDirs {
		dir := queue[0]
		queue = queue[1:]
		visited++

		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			if strings.HasSuffix(entry.Name(), ".app") {
				results = append(results, collectMacOSExecutables(path)...)
			} else {
				queue = append(queue, path)
			}
		}
	}
	return results
}

func collectMacOSExecutables(appPath string) []string {
	entries, err := os.ReadDir(filepath.Join(appPath, "Contents", "MacOS"))
	if err != nil {
		return nil
	}
	var results []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		results = append(results, filepath.Join(appPath, "Contents", "MacOS", entry.Name()))
	}
	return results
}

// mergeProcessNames adds the basenames of resolved executable paths to the
// process name list, so a rule matches whichever form sing-box reports.
func mergeProcessNames(names []string, processPaths []string) []string {
	for _, path := range processPaths {
		base := filepath.Base(path)
		names = append(names, base)
		if ext := filepath.Ext(base); ext != "" {
			names = append(names, strings.TrimSuffix(base, ext))
		}
	}
	return dedupe(names)
}

func dedupe(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

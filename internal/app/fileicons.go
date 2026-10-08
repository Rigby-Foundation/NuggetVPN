package app

import (
	"os"
	"path/filepath"
	"sync"
)

// maxIconsPerCall bounds one request; the list asks only for what it shows.
const maxIconsPerCall = 64

var fileIconCache sync.Map // path -> data URL, "" for none

// GetFileIcons returns programs' icons by file path, as PNG data URLs; a path
// with no icon maps to "". It reads the icon the system shows for the file —
// what the file manager would draw for it — for paths the core reported
// against connections. Nothing about the running program is touched.
func (a *App) GetFileIcons(paths []string) map[string]string {
	result := map[string]string{}
	for index, path := range paths {
		if index >= maxIconsPerCall {
			break
		}
		if cached, ok := fileIconCache.Load(path); ok {
			result[path] = cached.(string)
			continue
		}
		icon := ""
		if filepath.IsAbs(path) {
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				icon = fileIcon(path)
			}
		}
		fileIconCache.Store(path, icon)
		result[path] = icon
	}
	return result
}

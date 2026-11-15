package app

import (
	"slices"
	"strings"
)

// ListSystemFonts returns the installed font family names available to Appearance.
func (a *App) ListSystemFonts() []string {
	names := []string{}
	seen := make(map[string]bool)
	for _, name := range systemFontFamilies() {
		name = strings.TrimSpace(name)
		key := strings.ToLower(name)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		names = append(names, name)
	}
	slices.SortFunc(names, func(a, b string) int {
		return strings.Compare(strings.ToLower(a), strings.ToLower(b))
	})
	return names
}

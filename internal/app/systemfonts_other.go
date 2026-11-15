//go:build ios || android || (darwin && !cgo) || (!darwin && !windows && !linux)

package app

func systemFontFamilies() []string {
	return nil
}

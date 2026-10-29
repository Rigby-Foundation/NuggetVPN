//go:build (!windows && !linux && !darwin) || android || ios || (darwin && !cgo)

package wallpaper

func wallpaperPaths() []string { return nil }

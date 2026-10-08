//go:build !windows && !(darwin && !ios)

package app

// fileIcon has no system icon to read here; programs keep the generic one.
func fileIcon(string) string { return "" }

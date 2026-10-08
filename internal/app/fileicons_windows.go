//go:build windows

package app

import (
	"syscall"
	"unsafe"
)

var (
	iconShell32     = syscall.NewLazyDLL("shell32.dll")
	procExtractIcon = iconShell32.NewProc("ExtractIconW")

	iconUser32      = syscall.NewLazyDLL("user32.dll")
	procDestroyIcon = iconUser32.NewProc("DestroyIcon")
)

// fileIcon is the first icon in the program file at path, as a PNG data URL;
// "" when it has none.
func fileIcon(path string) string {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	// hInstance (none), the file, the first icon in it.
	icon, _, _ := procExtractIcon.Call(0, uintptr(unsafe.Pointer(name)), 0)
	// 0: the file has no icon; 1: it is not a file icons can be read from.
	if icon == 0 || icon == 1 {
		return ""
	}
	defer procDestroyIcon.Call(icon)

	return iconPNG(icon)
}

// iconPNG turns an icon handle into "data:image/png;base64,…", or "" if it
// cannot. TODO: the conversion; until it is written, Windows keeps the
// generic icon.
func iconPNG(icon uintptr) string {
	_ = icon
	return ""
}

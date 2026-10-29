package wallpaper

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var systemParametersInfo = windows.NewLazySystemDLL("user32.dll").NewProc("SystemParametersInfoW")

func wallpaperPaths() []string {
	var path [windows.MAX_PATH]uint16
	// SPI_GETDESKWALLPAPER returns the current desktop image, independent
	// of whether Windows' automatic accent colour setting is enabled.
	ok, _, _ := systemParametersInfo.Call(0x0073, uintptr(len(path)), uintptr(unsafe.Pointer(&path[0])), 0)
	if ok == 0 {
		return nil
	}
	return []string{windows.UTF16ToString(path[:])}
}

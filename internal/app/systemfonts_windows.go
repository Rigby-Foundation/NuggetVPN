package app

import (
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// LOGFONTW, the leading field of the font descriptor passed by GDI.
type systemLogFont struct {
	Height, Width, Escapement, Orientation, Weight int32
	Italic, Underline, StrikeOut, CharSet          byte
	OutPrecision, ClipPrecision, Quality, Family   byte
	FaceName                                       [32]uint16
}

var (
	fontEnumMu    sync.Mutex
	fontEnumNames []string
	fontCallback  = windows.NewCallback(collectSystemFont)
	fontUser32    = windows.NewLazySystemDLL("user32.dll")
	fontGetDC     = fontUser32.NewProc("GetDC")
	fontReleaseDC = fontUser32.NewProc("ReleaseDC")
	fontEnumerate = windows.NewLazySystemDLL("gdi32.dll").NewProc("EnumFontFamiliesExW")
)

func collectSystemFont(font *systemLogFont, _, _, _ uintptr) uintptr {
	name := windows.UTF16ToString(font.FaceName[:])
	if !strings.HasPrefix(name, "@") {
		fontEnumNames = append(fontEnumNames, name)
	}
	return 1
}

func systemFontFamilies() []string {
	fontEnumMu.Lock()
	defer fontEnumMu.Unlock()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	dc, _, _ := fontGetDC.Call(0)
	if dc == 0 {
		return nil
	}
	defer fontReleaseDC.Call(0, dc)

	const defaultCharset = 1
	filter := systemLogFont{CharSet: defaultCharset}
	fontEnumNames = nil
	fontEnumerate.Call(dc, uintptr(unsafe.Pointer(&filter)), fontCallback, 0, 0)
	names := fontEnumNames
	fontEnumNames = nil
	return names
}

//go:build darwin && !ios && cgo

package app

/*
#cgo LDFLAGS: -framework CoreText -framework CoreFoundation
#include <CoreText/CoreText.h>
*/
import "C"

func systemFontFamilies() []string {
	families := C.CTFontManagerCopyAvailableFontFamilyNames()
	if families == 0 {
		return nil
	}
	defer C.CFRelease(C.CFTypeRef(families))

	count := C.CFArrayGetCount(families)
	names := make([]string, 0, int(count))
	for index := C.CFIndex(0); index < count; index++ {
		name := C.CFStringRef(uintptr(C.CFArrayGetValueAtIndex(families, index)))
		size := C.CFStringGetMaximumSizeForEncoding(C.CFStringGetLength(name), C.kCFStringEncodingUTF8) + 1
		buf := make([]C.char, int(size))
		if C.CFStringGetCString(name, &buf[0], size, C.kCFStringEncodingUTF8) != 0 {
			names = append(names, C.GoString(&buf[0]))
		}
	}
	return names
}

//go:build darwin && !ios

package app

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

// The icon Finder shows for the file at path, drawn at 32×32 points (64
// pixels) and encoded as PNG. Returns NULL when there is none.
static NSData *nuggetFileIconPNG(const char *path) {
	@autoreleasepool {
		NSString *file = [NSString stringWithUTF8String:path];
		NSImage *image = [[NSWorkspace sharedWorkspace] iconForFile:file];
		if (!image) return nil;
		NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
			initWithBitmapDataPlanes:NULL pixelsWide:64 pixelsHigh:64 bitsPerSample:8
			samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
			bytesPerRow:0 bitsPerPixel:0];
		[NSGraphicsContext saveGraphicsState];
		[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
		[image drawInRect:NSMakeRect(0, 0, 64, 64) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0];
		[NSGraphicsContext restoreGraphicsState];
		return [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
	}
}

static int nuggetFileIcon(const char *path, void **bytes, int *length) {
	NSData *png = nuggetFileIconPNG(path);
	if (!png || png.length == 0) return 0;
	*length = (int)png.length;
	*bytes = malloc(png.length);
	memcpy(*bytes, png.bytes, png.length);
	return 1;
}
*/
import "C"

import (
	"encoding/base64"
	"strings"
	"unsafe"
)

// fileIcon is the icon Finder shows for the program at path. A program
// inside an app bundle (…/Discord.app/Contents/MacOS/Discord) gets the
// bundle's icon, which is the one people know it by.
func fileIcon(path string) string {
	if index := strings.Index(path, ".app/"); index >= 0 {
		path = path[:index+len(".app")]
	}
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	var bytes unsafe.Pointer
	var length C.int
	if C.nuggetFileIcon(cPath, &bytes, &length) == 0 {
		return ""
	}
	defer C.free(bytes)
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(C.GoBytes(bytes, length))
}

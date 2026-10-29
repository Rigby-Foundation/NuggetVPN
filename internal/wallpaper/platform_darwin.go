//go:build darwin && !ios && cgo

package wallpaper

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit -framework ImageIO
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#include <stdlib.h>

static char *nuggetWallpaperPath(void) {
	__block char *path = NULL;
	void (^read)(void) = ^{
		@autoreleasepool {
			NSScreen *screen = [NSScreen screens].firstObject;
			NSURL *url = screen ? [[NSWorkspace sharedWorkspace] desktopImageURLForScreen:screen] : nil;
			if (url.isFileURL) path = strdup(url.fileSystemRepresentation);
		}
	};
	// NSWorkspace requires the app's main thread.
	if ([NSThread isMainThread]) read();
	else dispatch_sync(dispatch_get_main_queue(), read);
	return path;
}

// ImageIO decodes HEIC/dynamic macOS wallpapers as well as ordinary images,
// downsampling before allocation instead of loading a full-resolution photo.
static int nuggetWallpaperPixels(const char *path, unsigned char *pixels) {
	@autoreleasepool {
		NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
		CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
		if (!source) return 0;
		NSDictionary *options = @{
			(id)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
			(id)kCGImageSourceThumbnailMaxPixelSize: @64,
			(id)kCGImageSourceCreateThumbnailWithTransform: @YES,
		};
		CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
		CFRelease(source);
		if (!image) return 0;
		CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
		CGContextRef context = CGBitmapContextCreate(pixels, 64, 64, 8, 64 * 4, space,
			kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
		CGColorSpaceRelease(space);
		if (!context) { CGImageRelease(image); return 0; }
		CGContextDrawImage(context, CGRectMake(0, 0, 64, 64), image);
		CGContextRelease(context);
		CGImageRelease(image);
		return 1;
	}
}
*/
import "C"

import (
	"fmt"
	"image"
	"unsafe"
)

func wallpaperPaths() []string {
	path := C.nuggetWallpaperPath()
	if path == nil {
		return nil
	}
	defer C.free(unsafe.Pointer(path))
	return []string{C.GoString(path)}
}

func readImage(path string) (image.Image, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	if C.nuggetWallpaperPixels(cPath, (*C.uchar)(unsafe.Pointer(&img.Pix[0]))) == 0 {
		return nil, fmt.Errorf("cannot decode wallpaper")
	}
	return img, nil
}

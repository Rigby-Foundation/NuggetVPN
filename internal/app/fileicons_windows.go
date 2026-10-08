//go:build windows

package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"syscall"
	"unsafe"
)

var (
	iconShell32     = syscall.NewLazyDLL("shell32.dll")
	procExtractIcon = iconShell32.NewProc("ExtractIconW")

	iconUser32      = syscall.NewLazyDLL("user32.dll")
	procDestroyIcon = iconUser32.NewProc("DestroyIcon")
	iconGetIconInfo = iconUser32.NewProc("GetIconInfo")
	iconGetDC       = iconUser32.NewProc("GetDC")
	iconReleaseDC   = iconUser32.NewProc("ReleaseDC")

	iconGdi32        = syscall.NewLazyDLL("gdi32.dll")
	iconGetObject    = iconGdi32.NewProc("GetObjectW")
	iconGetDIBits    = iconGdi32.NewProc("GetDIBits")
	iconDeleteObject = iconGdi32.NewProc("DeleteObject")
)

// ICONINFO
type iconInfo struct {
	fIcon    int32
	xHotspot uint32
	yHotspot uint32
	hbmMask  uintptr
	hbmColor uintptr
}

// BITMAP
type winBitmap struct {
	bmType       int32
	bmWidth      int32
	bmHeight     int32
	bmWidthBytes int32
	bmPlanes     uint16
	bmBitsPixel  uint16
	bmBits       uintptr
}

// BITMAPINFOHEADER
type bitmapInfoHeader struct {
	biSize          uint32
	biWidth         int32
	biHeight        int32
	biPlanes        uint16
	biBitCount      uint16
	biCompression   uint32
	biSizeImage     uint32
	biXPelsPerMeter int32
	biYPelsPerMeter int32
	biClrUsed       uint32
	biClrImportant  uint32
}

// BITMAPINFO; the colour table is unused for 32 bpp BI_RGB, but leave room
// in case a driver writes into it anyway.
type bitmapInfo struct {
	header bitmapInfoHeader
	colors [256]uint32
}

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
// cannot.
func iconPNG(icon uintptr) string {
	var ii iconInfo
	if r, _, _ := iconGetIconInfo.Call(icon, uintptr(unsafe.Pointer(&ii))); r == 0 {
		return ""
	}
	// GetIconInfo hands us copies of both bitmaps; we own them.
	if ii.hbmMask != 0 {
		defer iconDeleteObject.Call(ii.hbmMask)
	}
	if ii.hbmColor != 0 {
		defer iconDeleteObject.Call(ii.hbmColor)
	}
	if ii.hbmMask == 0 {
		return ""
	}

	dc, _, _ := iconGetDC.Call(0)
	if dc == 0 {
		return ""
	}
	defer iconReleaseDC.Call(0, dc)

	var img *image.NRGBA
	if ii.hbmColor != 0 {
		img = colorIcon(dc, ii.hbmColor, ii.hbmMask)
	} else {
		img = monoIcon(dc, ii.hbmMask)
	}
	if img == nil {
		return ""
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

// colorIcon builds the image of an icon with a colour bitmap. A 32-bit icon
// carries its own alpha; an older one gets its transparency from the AND mask.
func colorIcon(dc, hbmColor, hbmMask uintptr) *image.NRGBA {
	w, h, ok := bitmapSize(hbmColor)
	if !ok {
		return nil
	}
	color := dibPixels(dc, hbmColor, w, h)
	if color == nil {
		return nil
	}

	hasAlpha := false
	for i := 3; i < len(color); i += 4 {
		if color[i] != 0 {
			hasAlpha = true
			break
		}
	}
	var mask []byte
	if !hasAlpha {
		mask = dibPixels(dc, hbmMask, w, h) // nil: treat as fully opaque
	}

	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for p := 0; p < w*h*4; p += 4 {
		b, g, r, a := color[p], color[p+1], color[p+2], color[p+3]
		if !hasAlpha {
			a = 255
			// Mask bit 1 (white) means transparent.
			if mask != nil && mask[p] != 0 {
				a = 0
			}
		}
		img.Pix[p], img.Pix[p+1], img.Pix[p+2], img.Pix[p+3] = r, g, b, a
	}
	return img
}

// monoIcon builds the image of a monochrome icon: one bitmap twice the icon's
// height, the AND mask on top and the XOR mask below.
func monoIcon(dc, hbmMask uintptr) *image.NRGBA {
	w, h2, ok := bitmapSize(hbmMask)
	if !ok || h2%2 != 0 {
		return nil
	}
	h := h2 / 2
	bits := dibPixels(dc, hbmMask, w, h2)
	if bits == nil {
		return nil
	}

	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		and := bits[i*4] != 0
		xor := bits[(i+w*h)*4] != 0
		p := i * 4
		switch {
		case !and: // opaque, black or white
			v := byte(0)
			if xor {
				v = 255
			}
			img.Pix[p], img.Pix[p+1], img.Pix[p+2], img.Pix[p+3] = v, v, v, 255
		case xor: // "invert the screen": no PNG equivalent, draw it black
			img.Pix[p+3] = 255
		default: // transparent
		}
	}
	return img
}

// bitmapSize is the width and height of a GDI bitmap.
func bitmapSize(bmp uintptr) (w, h int, ok bool) {
	var bm winBitmap
	if r, _, _ := iconGetObject.Call(bmp, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm))); r == 0 {
		return 0, 0, false
	}
	return int(bm.bmWidth), int(bm.bmHeight), bm.bmWidth > 0 && bm.bmHeight > 0
}

// dibPixels reads a bitmap as top-down 32-bit BGRA rows, or nil on failure.
// Monochrome bitmaps come out as black (0) and white (0xFFFFFF) pixels.
func dibPixels(dc, bmp uintptr, w, h int) []byte {
	bi := bitmapInfo{header: bitmapInfoHeader{
		biWidth:    int32(w),
		biHeight:   -int32(h), // negative: top-down rows
		biPlanes:   1,
		biBitCount: 32,
		// biCompression 0 = BI_RGB
	}}
	bi.header.biSize = uint32(unsafe.Sizeof(bi.header))

	pix := make([]byte, w*h*4)
	r, _, _ := iconGetDIBits.Call(
		dc, bmp, 0, uintptr(h),
		uintptr(unsafe.Pointer(&pix[0])),
		uintptr(unsafe.Pointer(&bi)),
		0, // DIB_RGB_COLORS
	)
	if r == 0 {
		return nil
	}
	return pix
}

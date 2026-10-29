// Package wallpaper extracts a theme colour from the desktop wallpaper.
package wallpaper

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

var cache struct {
	sync.Mutex
	path    string
	modTime time.Time
	size    int64
	palette string
}

// Palette returns only the extracted colour; wallpaper paths and pixels stay
// in the native backend. The frontend supplies the system's light/dark mode.
// Discovery runs again on each call, but unchanged images are decoded once.
func Palette() string {
	return paletteForPaths(wallpaperPaths())
}

func paletteForPaths(paths []string) string {
	cache.Lock()
	defer cache.Unlock()
	for _, source := range paths {
		path := localPath(source)
		if path == "" {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if path == cache.path && info.ModTime().Equal(cache.modTime) && info.Size() == cache.size {
			return cache.palette
		}
		img, err := readImage(path)
		if err != nil {
			continue
		}
		seed := dominantColor(img)
		if seed == "" {
			continue
		}
		data, _ := json.Marshal(struct {
			Seed string `json:"seed"`
		}{seed})
		cache.path, cache.modTime, cache.size = path, info.ModTime(), info.Size()
		cache.palette = string(data)
		return cache.palette
	}
	return ""
}

func localPath(source string) string {
	source = strings.TrimSpace(source)
	if strings.HasPrefix(source, "file:") {
		u, err := url.Parse(source)
		if err != nil || (u.Host != "" && u.Host != "localhost") {
			return ""
		}
		source = filepath.FromSlash(u.Path)
	}
	if !filepath.IsAbs(source) {
		return ""
	}
	return source
}

func decodeImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// Bound allocations for unusually large or invalid wallpaper files.
	config, _, err := image.DecodeConfig(io.LimitReader(f, 64<<20))
	if err != nil {
		return nil, err
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, fmt.Errorf("wallpaper dimensions exceed limit")
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	img, _, err := image.Decode(io.LimitReader(f, 64<<20))
	return img, err
}

// Quantize a small, evenly spaced sample, favouring colours with both a
// substantial population and some saturation. Averaging the entire photo
// would usually produce a muddy grey unrelated to its visible colours.
func dominantColor(img image.Image) string {
	type bucket struct{ count, r, g, b float64 }
	var bins [4096]bucket
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return ""
	}
	for y := 0; y < min(height, 64); y++ {
		for x := 0; x < min(width, 64); x++ {
			pixel := color.NRGBAModel.Convert(img.At(bounds.Min.X+x*width/min(width, 64), bounds.Min.Y+y*height/min(height, 64))).(color.NRGBA)
			if pixel.A < 128 {
				continue
			}
			index := int(pixel.R>>4)<<8 | int(pixel.G>>4)<<4 | int(pixel.B>>4)
			bin := &bins[index]
			bin.count++
			bin.r += float64(pixel.R)
			bin.g += float64(pixel.G)
			bin.b += float64(pixel.B)
		}
	}
	best, result := -1.0, ""
	for _, bin := range bins {
		if bin.count == 0 {
			continue
		}
		r, g, b := bin.r/bin.count, bin.g/bin.count, bin.b/bin.count
		hi, lo := max(r, g, b), min(r, g, b)
		saturation := (hi - lo) / max(hi, 1)
		// Ignore near-black/white highlights when a useful colour exists.
		lightnessWeight := 1.0
		if hi < 24 || lo > 240 {
			lightnessWeight = 0.1
		}
		score := math.Sqrt(bin.count) * (0.1 + saturation*saturation) * lightnessWeight
		if score > best {
			best = score
			result = fmt.Sprintf("#%02x%02x%02x", int(math.Round(r)), int(math.Round(g)), int(math.Round(b)))
		}
	}
	return result
}

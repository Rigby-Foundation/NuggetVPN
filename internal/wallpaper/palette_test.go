package wallpaper

import (
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDominantColor(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.NRGBA{R: 220, G: 220, B: 220, A: 255}), image.Point{}, draw.Src)
	// A substantial blue patch should supply the accent, while neutral
	// surfaces and a few red noise pixels should not determine it.
	draw.Draw(img, image.Rect(8, 8, 32, 40), image.NewUniform(color.NRGBA{R: 32, G: 96, B: 224, A: 255}), image.Point{}, draw.Src)
	img.SetNRGBA(0, 0, color.NRGBA{R: 255, A: 255})
	if got := dominantColor(img); got != "#2060e0" {
		t.Fatalf("accent = %s, want blue #2060e0", got)
	}
}

func TestNeutralAndTransparentImages(t *testing.T) {
	img := image.NewNRGBA(image.Rect(10, 20, 18, 28))
	if got := dominantColor(img); got != "" {
		t.Fatalf("transparent image produced %q", got)
	}
	draw.Draw(img, img.Bounds(), image.NewUniform(color.Gray{Y: 128}), image.Point{}, draw.Src)
	if got := dominantColor(img); got != "#808080" {
		t.Fatalf("neutral image produced %q", got)
	}
}

func TestPaletteRefreshAndUnavailableWallpaper(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wallpaper.png")
	write := func(c color.NRGBA, mod time.Time) {
		t.Helper()
		file, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
		draw.Draw(img, img.Bounds(), image.NewUniform(c), image.Point{}, draw.Src)
		if err := png.Encode(file, img); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mod, mod); err != nil {
			t.Fatal(err)
		}
	}
	check := func(want string) {
		t.Helper()
		var palette struct{ Seed string }
		if err := json.Unmarshal([]byte(paletteForPaths([]string{path + ".missing", path})), &palette); err != nil {
			t.Fatal(err)
		}
		if palette.Seed != want {
			t.Fatalf("seed = %q, want %q", palette.Seed, want)
		}
	}
	write(color.NRGBA{R: 200, A: 255}, time.Unix(100, 0))
	check("#c80000")
	check("#c80000") // the cached palette
	write(color.NRGBA{B: 200, A: 255}, time.Unix(200, 0))
	check("#0000c8") // replacing the same wallpaper path invalidates it
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := paletteForPaths([]string{path}); got != "" {
		t.Fatalf("missing wallpaper returned stale palette %s", got)
	}
}

func TestLocalPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "blue sky.png")
	if got := localPath(path); got != path {
		t.Fatalf("path changed to %q", got)
	}
	for _, source := range []string{"https://example.com/wallpaper.png", "file://other-host/wallpaper.png", "relative.png", ""} {
		if got := localPath(source); got != "" {
			t.Errorf("accepted nonlocal path %q as %q", source, got)
		}
	}
}

func TestDecodeRejectsHugeDimensions(t *testing.T) {
	// Valid PNG header/CRC declaring an enormous image. Reject it before
	// allocating its pixels, even though its compressed data is absent.
	data := make([]byte, 33)
	copy(data, "\x89PNG\r\n\x1a\n")
	binary.BigEndian.PutUint32(data[8:12], 13)
	copy(data[12:], "IHDR")
	binary.BigEndian.PutUint32(data[16:20], 100_000)
	binary.BigEndian.PutUint32(data[20:24], 100_000)
	data[24], data[25] = 8, 2
	binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
	path := filepath.Join(t.TempDir(), "oversized.png")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeImage(path); err == nil || err.Error() != "wallpaper dimensions exceed limit" {
		t.Fatalf("expected dimensions limit, got %v", err)
	}
}

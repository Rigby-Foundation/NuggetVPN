//go:build linux && !android

package wallpaper

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPlasmaWallpaperSections(t *testing.T) {
	config := `[Containments][2][Wallpaper][org.kde.image][General]
Image=file:///home/user/blue%20sky.png
[Containments][2][General]
Image=/unrelated.png
[Containments][3][Wallpaper][org.kde.image][General]
Image=/home/user/second.png
`
	want := []string{"file:///home/user/blue%20sky.png", "/home/user/second.png"}
	if got := plasmaWallpapers(config); !reflect.DeepEqual(got, want) {
		t.Fatalf("wallpapers = %v, want %v", got, want)
	}
	if got := localPath(want[0]); got != "/home/user/blue sky.png" {
		t.Fatalf("file URI not decoded: %q", got)
	}
}

func TestSlideshowImages(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "background.xml")
	data := `<background><static><duration>100</duration><file><size width="1920" height="1080">blue.png</size><size width="3840" height="2160">blue-4k.png</size></file></static></background>`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	want := []string{filepath.Join(dir, "blue.png"), filepath.Join(dir, "blue-4k.png")}
	if got := slideshowImages(path); !reflect.DeepEqual(got, want) {
		t.Fatalf("slideshow images = %v, want %v", got, want)
	}
}

func TestGNOMEDarkWallpaper(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\ncase \"$3\" in\ncolor-scheme) echo \"'prefer-dark'\" ;;\npicture-uri-dark) echo \"'file:///dark.png'\" ;;\npicture-uri) echo \"'file:///light.png'\" ;;\nesac\n"
	if err := os.WriteFile(filepath.Join(dir, "gsettings"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	t.Setenv("XDG_CURRENT_DESKTOP", "GNOME")
	t.Setenv("DESKTOP_SESSION", "gnome")
	want := []string{"/dark.png", "/light.png"}
	if got := wallpaperPaths(); !reflect.DeepEqual(got, want) {
		t.Fatalf("wallpapers = %v, want %v", got, want)
	}
}

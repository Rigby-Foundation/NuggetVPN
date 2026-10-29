//go:build linux && !android

package wallpaper

import (
	"bufio"
	"context"
	"encoding/xml"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func wallpaperPaths() []string {
	// A missing desktop service must not leave a binding call hanging.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	query := func(name string, args ...string) string {
		out, err := exec.CommandContext(ctx, name, args...).Output()
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(out))
	}
	desktop := strings.ToLower(os.Getenv("XDG_CURRENT_DESKTOP") + ":" + os.Getenv("DESKTOP_SESSION"))
	var paths []string
	switch {
	case strings.Contains(desktop, "kde"), strings.Contains(desktop, "plasma"):
		config := os.Getenv("XDG_CONFIG_HOME")
		if config == "" {
			home, _ := os.UserHomeDir()
			config = filepath.Join(home, ".config")
		}
		if data, err := os.ReadFile(filepath.Join(config, "plasma-org.kde.plasma.desktop-appletsrc")); err == nil {
			paths = plasmaWallpapers(string(data))
		}
	case strings.Contains(desktop, "xfce"):
		properties := query("xfconf-query", "-c", "xfce4-desktop", "-l")
		for _, property := range strings.Fields(properties) {
			if strings.HasPrefix(property, "/backdrop/") && (strings.HasSuffix(property, "/last-image") || strings.HasSuffix(property, "/image-path")) {
				paths = append(paths, query("xfconf-query", "-c", "xfce4-desktop", "-p", property))
			}
		}
	case strings.Contains(desktop, "cinnamon"):
		paths = []string{variantString(query("gsettings", "get", "org.cinnamon.desktop.background", "picture-uri"))}
	case strings.Contains(desktop, "mate"):
		paths = []string{variantString(query("gsettings", "get", "org.mate.background", "picture-filename"))}
	default:
		// GNOME, Unity, Budgie and other GNOME-based desktops.
		if strings.Contains(query("gsettings", "get", "org.gnome.desktop.interface", "color-scheme"), "prefer-dark") {
			paths = append(paths, variantString(query("gsettings", "get", "org.gnome.desktop.background", "picture-uri-dark")))
		}
		paths = append(paths, variantString(query("gsettings", "get", "org.gnome.desktop.background", "picture-uri")))
	}
	var result []string
	for _, path := range paths {
		path = localPath(path)
		if strings.EqualFold(filepath.Ext(path), ".xml") {
			result = append(result, slideshowImages(path)...)
		} else if path != "" {
			result = append(result, path)
		}
	}
	return result
}

func variantString(value string) string {
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		value = value[1 : len(value)-1]
		value = strings.ReplaceAll(value, "\\'", "'")
		value = strings.ReplaceAll(value, "\\\\", "\\")
	}
	return value
}

func plasmaWallpapers(config string) []string {
	var paths []string
	wallpaper := false
	scanner := bufio.NewScanner(strings.NewReader(config))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "[") {
			wallpaper = strings.HasPrefix(line, "[Containments][") && strings.HasSuffix(line, "[Wallpaper][org.kde.image][General]")
			continue
		}
		if wallpaper && strings.HasPrefix(line, "Image=") {
			paths = append(paths, strings.TrimPrefix(line, "Image="))
		}
	}
	return paths
}

// GNOME also ships timed XML wallpapers. Use their first still image as a
// representative palette, including files with per-resolution <size> entries.
func slideshowImages(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	decoder := xml.NewDecoder(io.LimitReader(f, 1<<20))
	var paths []string
	inFile := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch token := token.(type) {
		case xml.StartElement:
			if token.Name.Local == "file" {
				inFile = true
			}
		case xml.EndElement:
			if token.Name.Local == "file" {
				inFile = false
				if len(paths) > 0 {
					return paths
				}
			}
		case xml.CharData:
			if inFile {
				if value := strings.TrimSpace(string(token)); value != "" {
					if !filepath.IsAbs(value) {
						value = filepath.Join(filepath.Dir(path), value)
					}
					paths = append(paths, value)
				}
			}
		}
	}
	return paths
}

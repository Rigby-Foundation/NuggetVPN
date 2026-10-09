//go:build linux && !android

package app

import (
	"bufio"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// desktopIcons maps a listed app to the icon its .desktop file names.
var desktopIcons sync.Map

// desktopApps lists the applications in the desktop's menus — their .desktop
// files, in the system, Flatpak and user folders — and the programs running
// now, which covers AppImages and others no menu lists. A menu app is chosen
// by the program its Exec line starts, a running one by its path; the
// routing rule matches either.
func desktopApps() []InstalledApp {
	home, _ := os.UserHomeDir()
	dirs := []string{
		"/usr/share/applications",
		"/usr/local/share/applications",
		"/var/lib/flatpak/exports/share/applications",
		filepath.Join(home, ".local/share/flatpak/exports/share/applications"),
		filepath.Join(home, ".local/share/applications"),
	}
	apps := []InstalledApp{}
	for _, dir := range dirs {
		files, _ := filepath.Glob(filepath.Join(dir, "*.desktop"))
		for _, file := range files {
			entry := readDesktopEntry(file)
			if entry.name == "" || entry.exec == "" || entry.hidden {
				continue
			}
			desktopIcons.Store(entry.exec, entry.icon)
			apps = append(apps, InstalledApp{Package: entry.exec, Label: entry.name})
		}
	}
	return sortApps(withRunning(sortApps(apps), runningPrograms(home)))
}

// runningPrograms is the programs running now that this user can see the
// executable of, each once. Those outside the home folder, /opt and mounted
// drives — shells, daemons, the desktop's own parts — count as the system's.
func runningPrograms(home string) []InstalledApp {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	userPlaces := []string{"/opt/", "/media/", "/mnt/", "/run/media/", "/tmp/"}
	if home != "" {
		userPlaces = append(userPlaces, strings.TrimSuffix(home, "/")+"/")
	}
	seen := map[string]bool{}
	programs := []InstalledApp{}
	for _, entry := range entries {
		if entry.Name()[0] < '0' || entry.Name()[0] > '9' {
			continue
		}
		path, err := os.Readlink(filepath.Join("/proc", entry.Name(), "exe"))
		if err != nil || path == "" || seen[path] {
			continue
		}
		// A program replaced while running reads as "/path (deleted)".
		path = strings.TrimSuffix(path, " (deleted)")
		seen[path] = true
		system := true
		for _, place := range userPlaces {
			if strings.HasPrefix(path, place) {
				system = false
				break
			}
		}
		programs = append(programs, InstalledApp{Package: path, Label: filepath.Base(path), System: system})
	}
	return programs
}

type desktopEntry struct {
	name, exec, icon string
	hidden           bool
}

// readDesktopEntry reads the [Desktop Entry] group of a .desktop file.
func readDesktopEntry(path string) desktopEntry {
	var entry desktopEntry
	file, err := os.Open(path)
	if err != nil {
		return entry
	}
	defer file.Close()
	inMain := false
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "[") {
			inMain = line == "[Desktop Entry]"
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !inMain || !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Name":
			entry.name = strings.TrimSpace(value)
		case "Exec":
			entry.exec = execProgram(value)
		case "Icon":
			entry.icon = strings.TrimSpace(value)
		case "NoDisplay", "Hidden":
			entry.hidden = entry.hidden || strings.TrimSpace(value) == "true"
		case "Type":
			entry.hidden = entry.hidden || strings.TrimSpace(value) != "Application"
		}
	}
	return entry
}

// execProgram is the program an Exec line starts: past "env VAR=x" and a
// launcher like "flatpak run", without quotes or field codes. A Flatpak app
// is named by its id, which is also its process name.
func execProgram(exec string) string {
	fields := strings.Fields(exec)
	for len(fields) > 0 {
		field := strings.Trim(fields[0], `"'`)
		switch {
		case field == "env" || strings.Contains(field, "="):
			fields = fields[1:]
			continue
		case filepath.Base(field) == "flatpak":
			for _, arg := range fields[1:] {
				if arg != "run" && !strings.HasPrefix(arg, "-") {
					return strings.Trim(arg, `"'`)
				}
			}
			return ""
		}
		return field
	}
	return ""
}

// desktopAppIcon reads the icon a listed app's .desktop file names, from the
// icon theme's usual sizes or pixmaps.
func desktopAppIcon(program string) string {
	value, ok := desktopIcons.Load(program)
	if !ok {
		return ""
	}
	name := value.(string)
	if name == "" {
		return ""
	}
	candidates := []string{name}
	if !filepath.IsAbs(name) {
		candidates = nil
		for _, base := range []string{"/usr/share/icons/hicolor", "/var/lib/flatpak/exports/share/icons/hicolor"} {
			for _, size := range []string{"64x64", "48x48", "128x128", "256x256", "scalable"} {
				for _, ext := range []string{".png", ".svg"} {
					candidates = append(candidates, filepath.Join(base, size, "apps", name+ext))
				}
			}
		}
		candidates = append(candidates, "/usr/share/pixmaps/"+name+".png", "/usr/share/pixmaps/"+name+".svg")
	}
	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil || len(data) > 512*1024 {
			continue
		}
		kind := "image/png"
		if strings.HasSuffix(path, ".svg") {
			kind = "image/svg+xml"
		}
		return "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	return ""
}

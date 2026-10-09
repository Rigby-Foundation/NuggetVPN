//go:build windows

package app

import (
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// desktopApps lists installed programs from the registry — the uninstall
// entries (what Settings → Apps shows), by the program their icon comes from,
// and App Paths, the programs Windows can start by name — and the programs
// running now, which covers portable ones. A program is chosen by its .exe
// path; the routing rule matches that path and the file name.
func desktopApps() []InstalledApp {
	apps := []InstalledApp{}
	add := func(label, path string) {
		path = programPath(path)
		if path == "" {
			return
		}
		apps = append(apps, windowsProgram(label, path))
	}

	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		for _, base := range []string{
			`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
			`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
		} {
			eachSubKey(root, base, func(key registry.Key, _ string) {
				if hidden, _, err := key.GetIntegerValue("SystemComponent"); err == nil && hidden == 1 {
					return
				}
				name, _, _ := key.GetStringValue("DisplayName")
				icon, _, _ := key.GetStringValue("DisplayIcon")
				add(strings.TrimSpace(name), icon)
			})
		}
		eachSubKey(root, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths`, func(key registry.Key, _ string) {
			path, _, _ := key.GetStringValue("")
			add("", path)
		})
	}
	return sortApps(withRunning(sortApps(apps), runningPrograms()))
}

// windowsProgram is a program by path, named by its file where nothing
// better names it; one in the Windows folder counts as the system's.
func windowsProgram(label, path string) InstalledApp {
	if label == "" {
		label = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	systemRoot := strings.ToLower(os.Getenv("SystemRoot"))
	system := systemRoot != "" && strings.HasPrefix(strings.ToLower(path), systemRoot+`\`)
	return InstalledApp{Package: path, Label: label, System: system}
}

// runningPrograms is the programs running now, each once, by the path of
// their .exe. Processes this user may not query (other users', protected
// ones) are skipped; their paths cannot be read.
func runningPrograms() []InstalledApp {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snapshot)

	seen := map[string]bool{}
	programs := []InstalledApp{}
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		path := processImage(entry.ProcessID)
		if path == "" || seen[strings.ToLower(path)] {
			continue
		}
		seen[strings.ToLower(path)] = true
		programs = append(programs, windowsProgram("", path))
	}
	return programs
}

// processImage is the full path of a process's .exe, or "".
func processImage(pid uint32) string {
	if pid == 0 {
		return ""
	}
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(process)
	buffer := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(process, 0, &buffer[0], &size); err != nil {
		return ""
	}
	path := windows.UTF16ToString(buffer[:size])
	if !strings.EqualFold(filepath.Ext(path), ".exe") {
		return ""
	}
	return path
}

// eachSubKey calls visit with every subkey of root\path it can open.
func eachSubKey(root registry.Key, path string, visit func(registry.Key, string)) {
	key, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return
	}
	defer key.Close()
	names, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return
	}
	for _, name := range names {
		sub, err := registry.OpenKey(key, name, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		visit(sub, name)
		sub.Close()
	}
}

// programPath is the .exe a registry value names, without quotes, an icon
// index (",0") or environment variables; "" for anything else, an
// uninstaller, or a file that is not there.
func programPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, `"`) {
		if end := strings.Index(value[1:], `"`); end >= 0 {
			value = value[1 : end+1]
		}
	} else if comma := strings.LastIndex(value, ","); comma > 0 && !strings.HasSuffix(strings.ToLower(value), ".exe") {
		value = value[:comma]
	}
	if expanded, err := registry.ExpandString(value); err == nil {
		value = expanded
	}
	value = strings.TrimSpace(value)
	if !strings.EqualFold(filepath.Ext(value), ".exe") || !filepath.IsAbs(value) {
		return ""
	}
	base := strings.ToLower(filepath.Base(value))
	for _, skip := range []string{"unins", "uninst", "setup", "update.exe", "installer"} {
		if strings.Contains(base, skip) {
			return ""
		}
	}
	if info, err := os.Stat(value); err != nil || info.IsDir() {
		return ""
	}
	return value
}

// desktopAppIcon is the icon Explorer shows for the program.
func desktopAppIcon(path string) string {
	if programPath(path) == "" {
		return ""
	}
	return cachedFileIcon(path)
}

//go:build android

package android

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// An Android app may only write inside its own folder, and the process's
// environment does not say where that is: HOME is "/" or /sdcard, and there
// are no XDG variables. A setenv from Java does not help either, since the Go
// runtime took its copy of the environment when the library loaded. So the
// folder is worked out here, from the package name and the user, before
// anything reads a path, and the variables the storage package uses point
// into it.
func init() {
	files := appFilesDir()
	if files == "" {
		return
	}
	runtime := filepath.Join(files, "runtime")
	cache := filepath.Join(filepath.Dir(files), "cache")
	_ = os.MkdirAll(runtime, 0o700)
	_ = os.Setenv("HOME", files)
	_ = os.Setenv("XDG_DATA_HOME", files)
	_ = os.Setenv("XDG_CONFIG_HOME", filepath.Join(files, "config"))
	// Not the system cache folder: Android may empty it while the core's
	// socket and rule lists are in use.
	_ = os.Setenv("XDG_CACHE_HOME", runtime)
	_ = os.Setenv("TMPDIR", cache)
}

// appFilesDir is the app's private files folder, like Context.getFilesDir():
// /data/user/<user>/<package>/files.
func appFilesDir() string {
	cmdline, err := os.ReadFile("/proc/self/cmdline")
	if err != nil {
		return ""
	}
	name := string(bytes.SplitN(cmdline, []byte{0}, 2)[0])
	// A service in its own process is named package:service.
	name, _, _ = strings.Cut(name, ":")
	if name == "" || strings.Contains(name, "/") {
		return ""
	}
	user := os.Getuid() / 100000
	for _, base := range []string{
		filepath.Join("/data/user", strconv.Itoa(user), name),
		filepath.Join("/data/data", name),
	} {
		if info, err := os.Stat(base); err == nil && info.IsDir() {
			return filepath.Join(base, "files")
		}
	}
	return ""
}

// Package storage owns the on-disk locations for profiles, settings and logs.
//
// The directories intentionally match the ones the Tauri build used
// (bundle identifier org.rigbyfoundation.nuggetvpn) so an upgrade keeps the
// user's existing profiles and settings.
package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Identifier is the bundle identifier used for per-user directories.
const Identifier = "org.rigbyfoundation.nuggetvpn"

var writeMu sync.Mutex

// DataDir returns the directory holding profiles.json and settings.json.
func DataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", Identifier)
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, Identifier)
		}
		return filepath.Join(home, "AppData", "Roaming", Identifier)
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, Identifier)
		}
		return filepath.Join(home, ".local", "share", Identifier)
	}
}

// LogDir returns the directory session.log is written to.
func LogDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Logs", Identifier)
	case "windows":
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, Identifier, "logs")
		}
		return filepath.Join(home, "AppData", "Local", Identifier, "logs")
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, Identifier, "logs")
		}
		return filepath.Join(home, ".local", "share", Identifier, "logs")
	}
}

// RuntimeDir holds the generated core config, the control socket and pid files.
func RuntimeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Caches", Identifier)
	case "windows":
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, Identifier, "runtime")
		}
		return filepath.Join(home, "AppData", "Local", Identifier, "runtime")
	default:
		if xdg := os.Getenv("XDG_CACHE_HOME"); xdg != "" {
			return filepath.Join(xdg, Identifier)
		}
		return filepath.Join(home, ".cache", Identifier)
	}
}

// ProfilesPath is the profiles.json location.
func ProfilesPath() string { return filepath.Join(DataDir(), "profiles.json") }

// SettingsPath is the settings.json location.
func SettingsPath() string { return filepath.Join(DataDir(), "settings.json") }

// LogPath is the rolling session log the UI tails.
func LogPath() string { return filepath.Join(LogDir(), "session.log") }

// maxUnixSocketPath is the practical limit for sockaddr_un.sun_path: 104 bytes
// on macOS and the BSDs, 108 on Linux. Exceeding it fails bind with the
// unhelpful "invalid argument".
const maxUnixSocketPath = 100

// ControlSocketPath is the unix socket the privileged core service listens on.
// A very long home directory falls back to a short path in the temp directory.
func ControlSocketPath() string {
	path := filepath.Join(RuntimeDir(), "core.sock")
	if len(path) <= maxUnixSocketPath {
		return path
	}
	return filepath.Join(os.TempDir(), fmt.Sprintf("nuggetvpn-%d.sock", os.Getuid()))
}

// CoreConfigPath is where the generated sing-box config is mirrored for
// debugging. The core service receives its config over the socket, so this file
// is informational only.
func CoreConfigPath() string { return filepath.Join(RuntimeDir(), "config.json") }

// ControlTokenPath is the 0600 file the GUI drops the control-socket token in
// for the elevated service to pick up.
//
// The token goes through a file rather than a command-line argument because
// argv is world-readable on Linux (/proc/<pid>/cmdline) and readable by other
// processes on Windows, which would hand every local account the credential for
// a root-owned control socket.
func ControlTokenPath() string { return filepath.Join(RuntimeDir(), "core.token") }

// EnsureDirs creates every directory the app writes to.
func EnsureDirs() error {
	for _, dir := range []string{DataDir(), LogDir(), RuntimeDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return nil
}

// LoadProfiles reads profiles.json, returning an empty slice when absent.
// Profile names are re-decoded on load because some providers percent-encode
// them more than once.
func LoadProfiles(decodeName func(string) string) []models.Profile {
	data, err := os.ReadFile(ProfilesPath())
	if err != nil {
		return []models.Profile{}
	}
	var profiles []models.Profile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return []models.Profile{}
	}

	changed := false
	for i := range profiles {
		if decodeName == nil {
			break
		}
		if decoded := decodeName(profiles[i].Name); decoded != profiles[i].Name {
			profiles[i].Name = decoded
			changed = true
		}
	}
	if changed {
		_ = SaveProfiles(profiles)
	}
	return profiles
}

// SaveProfiles writes profiles.json atomically.
func SaveProfiles(profiles []models.Profile) error {
	if profiles == nil {
		profiles = []models.Profile{}
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(ProfilesPath(), data)
}

// LoadSettings reads settings.json, falling back to defaults.
func LoadSettings() models.AppSettings {
	settings := models.DefaultSettings()
	data, err := os.ReadFile(SettingsPath())
	if err != nil {
		return settings
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return models.DefaultSettings()
	}
	settings.Normalize()
	return settings
}

// SaveSettings writes settings.json atomically.
func SaveSettings(settings models.AppSettings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(SettingsPath(), data)
}

// writeFile writes through a temporary file so a crash mid-write cannot leave a
// truncated profiles.json behind.
func writeFile(path string, data []byte) error {
	writeMu.Lock()
	defer writeMu.Unlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

//go:build !windows && !darwin && !android

package autostart

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// An XDG autostart entry, which GNOME, KDE and most other desktops honour.
func entryPath() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "autostart", "nuggetvpn.desktop"), nil
}

func enable(executable string) error {
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// Exec quoting per the desktop entry spec: double quotes, with ", `, $
	// and \ escaped inside them.
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", `$`, `\$`).Replace(executable)
	entry := "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=NuggetVPN\n" +
		"Exec=\"" + quoted + "\" " + Flag + "\n" +
		"X-GNOME-Autostart-enabled=true\n"
	return os.WriteFile(path, []byte(entry), 0o644)
}

func disable() error {
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func enabled() bool {
	path, err := entryPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

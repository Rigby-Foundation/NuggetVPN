package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// These paths are set at GUI startup, before services open the stores.
var migration struct{ data, logs, webview string }

// MigrateLegacyDirectories moves desktop data after the single-instance lock is
// acquired. The old path stays usable if the filesystem prevents the move.
func MigrateLegacyDirectories() error {
	if runtime.GOOS == "android" || runtime.GOOS == "ios" {
		return nil
	}
	var dataErr, logErr, webviewErr error
	migration.data, dataErr = moveLegacyDirectory(dataDir(legacyIdentifier), dataDir(Identifier))
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		migration.logs, logErr = moveLegacyDirectory(logDir(legacyIdentifier), logDir(Identifier))
	}
	if runtime.GOOS == "darwin" {
		if home, err := os.UserHomeDir(); err == nil {
			_, webviewErr = moveLegacyDirectory(
				filepath.Join(home, "Library", "WebKit", legacyIdentifier),
				filepath.Join(home, "Library", "WebKit", Identifier),
			)
		}
	}
	if runtime.GOOS == "windows" {
		if config, err := os.UserConfigDir(); err == nil {
			migration.webview, webviewErr = moveLegacyDirectory(
				filepath.Join(config, "NuggetVPN.exe"), filepath.Join(config, "Kage.exe"),
			)
		}
	}
	return errors.Join(dataErr, logErr, webviewErr)
}

func WebviewDataPath() string {
	if runtime.GOOS != "windows" {
		return ""
	}
	if migration.webview != "" {
		return migration.webview
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(config, "Kage.exe")
}

func moveLegacyDirectory(old, current string) (string, error) {
	if _, err := os.Stat(old); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return current, nil
		}
		return old, err
	}
	if entries, err := os.ReadDir(current); err == nil {
		if len(entries) > 0 {
			return current, nil
		}
		if err := os.Remove(current); err != nil {
			return old, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return old, err
	}
	if err := os.MkdirAll(filepath.Dir(current), 0o755); err != nil {
		return old, err
	}
	if err := os.Rename(old, current); err != nil {
		return old, fmt.Errorf("move %s to %s: %w", old, current, err)
	}
	return current, nil
}

//go:build darwin && !ios

package autostart

import (
	"encoding/xml"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const label = "org.rigbyfoundation.nuggetvpn"

// A launch agent in the user's library: loaded at login, no administrator
// rights, and listed under System Settings' login items.
func agentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist"), nil
}

func enable(executable string) error {
	path, err := agentPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	// Escaped through the XML encoder: an app bundle path can contain any
	// character a folder name can, including & and <.
	escape := func(value string) string {
		var builder strings.Builder
		_ = xml.EscapeText(&builder, []byte(value))
		return builder.String()
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + label + `</string>
	<key>ProgramArguments</key>
	<array>
		<string>` + escape(executable) + `</string>
		<string>` + Flag + `</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`
	return os.WriteFile(path, []byte(plist), 0o644)
}

func disable() error {
	path, err := agentPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func enabled() bool {
	path, err := agentPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

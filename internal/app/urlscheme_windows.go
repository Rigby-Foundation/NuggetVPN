//go:build windows

package app

import (
	"os"

	"golang.org/x/sys/windows/registry"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// registerURLScheme makes nuggetvpn:// links open this app, for the current
// user — no administrator rights needed, and nothing left for another user.
// Written on every start, so moving the app keeps the links working. Only
// release builds do it: a development build would point the scheme at a
// binary that is about to be rebuilt.
func registerURLScheme() {
	if models.DevBuild {
		return
	}
	self, err := os.Executable()
	if err != nil {
		return
	}
	root, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+URLScheme, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer root.Close()
	_ = root.SetStringValue("", "URL:NuggetVPN")
	_ = root.SetStringValue("URL Protocol", "")

	if icon, _, err := registry.CreateKey(root, "DefaultIcon", registry.SET_VALUE); err == nil {
		_ = icon.SetStringValue("", `"`+self+`",0`)
		icon.Close()
	}
	if command, _, err := registry.CreateKey(root, `shell\open\command`, registry.SET_VALUE); err == nil {
		_ = command.SetStringValue("", `"`+self+`" "%1"`)
		command.Close()
	}
}

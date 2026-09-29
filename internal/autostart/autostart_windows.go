//go:build windows

package autostart

import (
	"errors"

	"golang.org/x/sys/windows/registry"
)

// The per-user Run key: no administrator rights, and it is what Task
// Manager's Startup tab lists and toggles.
const (
	runKey    = `Software\Microsoft\Windows\CurrentVersion\Run`
	valueName = "NuggetVPN"
)

func enable(executable string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	// Quoted, because the path very likely contains spaces.
	return key.SetStringValue(valueName, `"`+executable+`" `+Flag)
}

func disable() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	defer key.Close()
	if err := key.DeleteValue(valueName); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func enabled() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	_, _, err = key.GetStringValue(valueName)
	return err == nil
}

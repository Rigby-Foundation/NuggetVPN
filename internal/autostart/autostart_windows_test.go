//go:build windows

package autostart

import (
	"os"
	"strings"
	"testing"

	"golang.org/x/sys/windows/registry"
)

// Writes to the real Run key, so it only runs when asked for, and never when
// a NuggetVPN entry already exists — it would remove the user's own.
func TestRegistersAndRemovesTheRunEntry(t *testing.T) {
	if os.Getenv("NUGGET_AUTOSTART_TEST") == "" {
		t.Skip("set NUGGET_AUTOSTART_TEST=1 to exercise the real Run key")
	}
	if Enabled() {
		t.Skip("a NuggetVPN startup entry already exists; not touching it")
	}
	t.Cleanup(func() { _ = Set(false) })

	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	if !Enabled() {
		t.Fatal("enabled, but not reported as enabled")
	}

	key, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	value, _, err := key.GetStringValue(valueName)
	key.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(value, `"`) || !strings.HasSuffix(value, `" `+Flag) {
		t.Errorf("the command should be the quoted executable plus %s, got %s", Flag, value)
	}

	if err := Set(false); err != nil {
		t.Fatal(err)
	}
	if Enabled() {
		t.Error("still enabled after disabling")
	}
	if err := Set(false); err != nil {
		t.Errorf("disabling twice should be harmless: %v", err)
	}
}

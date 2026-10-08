//go:build darwin && !ios

package app

import (
	"strings"
	"testing"
)

func TestFileIconReadsAnAppsIcon(t *testing.T) {
	// Safari is on every Mac; its binary sits inside the bundle.
	icons := (&App{}).GetFileIcons([]string{"/Applications/Safari.app/Contents/MacOS/Safari", "relative/path", "/no/such/file"})
	safari := icons["/Applications/Safari.app/Contents/MacOS/Safari"]
	if !strings.HasPrefix(safari, "data:image/png;base64,") || len(safari) < 2000 {
		t.Fatalf("Safari's icon: got %d bytes", len(safari))
	}
	if icons["relative/path"] != "" || icons["/no/such/file"] != "" {
		t.Fatal("a relative or missing path must have no icon")
	}
}

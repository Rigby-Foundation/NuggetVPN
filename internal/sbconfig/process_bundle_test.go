package sbconfig

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// An XPC service built into an app runs the executable in its
// Contents/MacOS; a rule naming the bundle must match that.
func TestXPCBundleResolvesToItsExecutable(t *testing.T) {
	bundle := filepath.Join(t.TempDir(), "Teams.app", "Contents", "XPCServices", "vcxpc.xpc")
	executable := filepath.Join(bundle, "Contents", "MacOS", "vcxpc")
	if err := os.MkdirAll(filepath.Dir(executable), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := extractProcessPaths([]string{bundle})
	if !slices.Contains(paths, executable) {
		t.Fatalf("paths %v do not include %s", paths, executable)
	}
	names := mergeProcessNames(expandProcessNames([]string{bundle}), paths)
	if !slices.Contains(names, "vcxpc") {
		t.Fatalf("names %v do not include vcxpc", names)
	}
}

package core

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// TestInstallCoresLive downloads every external core from GitHub, as the
// service would, and runs each one's version command. It fetches around
// 100 MB, so it only runs when asked: NUGGET_CORE_TEST=1.
func TestInstallCoresLive(t *testing.T) {
	if os.Getenv("NUGGET_CORE_TEST") == "" {
		t.Skip("set NUGGET_CORE_TEST=1 to download the cores")
	}
	root := t.TempDir()
	original := coresRoot
	coresRoot = func() string { return root }
	lockCoresRoot = false
	defer func() { coresRoot, lockCoresRoot = original, true }()

	versionArgs := map[string][]string{CoreXray: {"version"}, CoreMihomo: {"-v"}, CoreSingBox: {"version"}}
	for _, name := range ExternalCores {
		info, err := InstallCore(context.Background(), name, nil)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		path, err := verifiedCore(name)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		output, err := exec.Command(path, versionArgs[name]...).CombinedOutput()
		first := strings.SplitN(strings.TrimSpace(string(output)), "\n", 2)[0]
		t.Logf("%s %s → %s", name, info.Version, first)
		if err != nil {
			t.Errorf("%s did not run: %v", name, err)
		}
		if name == CoreSingBox && !strings.HasPrefix(info.Version, "1.15.") {
			t.Errorf("official sing-box should be the 1.15 line, got %s", info.Version)
		}
	}
}

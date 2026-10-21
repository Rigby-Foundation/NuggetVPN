//go:build darwin && !ios

package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The service's launchd job is a valid property list by Apple's own check,
// arguments with spaces, quotes and ampersands included.
func TestLaunchdJobIsAValidPlist(t *testing.T) {
	job := launchdJob([]string{"/Applications/Nugget VPN.app/Contents/MacOS/NuggetVPN", "--socket", `/tmp/a&b "c".sock`}, serviceLogDir+"/service.log")
	path := filepath.Join(t.TempDir(), "job.plist")
	if err := os.WriteFile(path, job, 0o644); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("plutil", "-lint", path).CombinedOutput(); err != nil {
		t.Fatalf("plutil rejected the job: %s\n%s", output, job)
	}
	output, err := exec.Command("plutil", "-extract", "ProgramArguments.2", "raw", path).Output()
	if err != nil || strings.TrimSpace(string(output)) != `/tmp/a&b "c".sock` {
		t.Fatalf("argument not kept as given: %q (%v)", output, err)
	}
	for _, key := range []string{"KeepAlive", "ProcessType"} {
		value, _ := exec.Command("plutil", "-extract", key, "raw", path).Output()
		t.Logf("%s = %s", key, strings.TrimSpace(string(value)))
	}
}

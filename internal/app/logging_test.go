package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogLinesKeepOneLevel(t *testing.T) {
	colored := "\x1b[36mINFO\x1b[0m[0000] network: updated default interface"
	if got := withLevel("info", colored); got != colored {
		t.Errorf("a line that already leads with its level gained a second one: %q", got)
	}
	if got := withLevel("warn", "something odd"); got != "WARN something odd" {
		t.Errorf("a bare message should be prefixed, got %q", got)
	}
	if got := withLevel("warn", "[Warning] Xray started"); got != "[Warning] Xray started" {
		t.Errorf("the Xray line already has its level, got %q", got)
	}
}

func TestRecentLogsRetainColorsAndOrderBeforeViewing(t *testing.T) {
	file, err := os.Create(filepath.Join(t.TempDir(), "session.log"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	a := &App{logFile: file}
	a.loggingOn.Store(true)
	a.appendLog("oldest")
	for range recentLogLimit - 2 {
		a.appendLog("earlier output")
	}
	colored := "\x1b[31m[Error]\x1b[0m core error"
	a.appendLog(colored, "latest output")

	lines := a.GetLogs().Lines
	if len(lines) != recentLogLimit || lines[0] != "earlier output" ||
		lines[len(lines)-2] != colored || lines[len(lines)-1] != "latest output" {
		t.Fatal("snapshot lost the recent lines' order or colours")
	}
	stored, err := os.ReadFile(file.Name())
	if err != nil || !strings.HasSuffix(string(stored), "[Error] core error\nlatest output\n") || strings.Contains(string(stored), "\x1b") {
		t.Fatalf("the saved log should be plain text, err=%v", err)
	}
	a.loggingOn.Store(false)
	if len(a.GetLogs().Lines) != 0 {
		t.Fatal("logs were exposed after logging was disabled")
	}
}

func TestStripANSI(t *testing.T) {
	line := "\x1b[37mDEBUG\x1b[0m[0003] [\x1b[38;5;185m485978537\x1b[0m 0ms] router: pre-match"
	want := "DEBUG[0003] [485978537 0ms] router: pre-match"
	if got := StripANSI(line); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

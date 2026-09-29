package app

import "testing"

func TestLogLinesKeepOneLevel(t *testing.T) {
	colored := "\x1b[36mINFO\x1b[0m[0000] network: updated default interface"
	if got := withLevel("info", colored); got != colored {
		t.Errorf("a line that already leads with its level gained a second one: %q", got)
	}
	if got := withLevel("warn", "something odd"); got != "WARN something odd" {
		t.Errorf("a bare message should be prefixed, got %q", got)
	}
}

func TestStripANSI(t *testing.T) {
	line := "\x1b[37mDEBUG\x1b[0m[0003] [\x1b[38;5;185m485978537\x1b[0m 0ms] router: pre-match"
	want := "DEBUG[0003] [485978537 0ms] router: pre-match"
	if got := StripANSI(line); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

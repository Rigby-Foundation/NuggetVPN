package app

import "testing"

func TestNewerVersion(t *testing.T) {
	for _, testCase := range []struct {
		candidate, current string
		want               bool
	}{
		{"2.0.1", "2.0.0", true},
		{"v2.1.0", "2.0.9", true},
		{"2.0.0", "2.0.0", false},
		{"1.9.9", "2.0.0", false},
		{"2.0.0", "2.0.0-beta.2", true},
		{"2.1.0-beta.1", "2.0.0", true},
		{"2.0.0-beta.3", "2.0.0", false},
		{"10.0.0", "9.9.9", true},
	} {
		if got := newerVersion(testCase.candidate, testCase.current); got != testCase.want {
			t.Errorf("newerVersion(%q, %q) = %v", testCase.candidate, testCase.current, got)
		}
	}
}

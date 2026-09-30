//go:build !windows && !android

package probe

import (
	"os/exec"
	"time"
)

// nativeICMP is Windows-only; elsewhere the system ping utility is used. A
// console program opens no window of its own on macOS or Linux, so there is
// nothing here to avoid.
func nativeICMP(string, time.Duration) (*uint64, bool) { return nil, false }

func hideConsole(*exec.Cmd) {}

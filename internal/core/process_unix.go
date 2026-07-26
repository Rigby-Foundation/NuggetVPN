//go:build !windows

package core

import (
	"os"
	"syscall"
)

// processAlive reports whether a pid is still running. Signal 0 performs the
// existence and permission check without delivering anything.
func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

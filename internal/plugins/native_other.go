//go:build !linux && !darwin && !freebsd && !windows

package plugins

import "os/exec"

func prepareNativeCommand(cmd *exec.Cmd)                 {}
func containNativeCommand(cmd *exec.Cmd) (func(), error) { return func() {}, nil }
func killNativeCommand(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

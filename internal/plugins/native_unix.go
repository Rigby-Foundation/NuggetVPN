//go:build linux || darwin || freebsd

package plugins

import (
	"os/exec"
	"syscall"
)

func prepareNativeCommand(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func containNativeCommand(cmd *exec.Cmd) (func(), error) {
	return func() { killNativeCommand(cmd) }, nil
}
func killNativeCommand(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}

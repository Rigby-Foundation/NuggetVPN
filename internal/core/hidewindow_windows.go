//go:build windows

package core

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps a console program from opening a console window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

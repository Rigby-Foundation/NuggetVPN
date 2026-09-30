//go:build !windows

package core

import "os/exec"

// hideWindow does nothing outside Windows: there is no console to hide.
func hideWindow(*exec.Cmd) {}

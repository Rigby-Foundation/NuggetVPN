//go:build !windows && !linux && !darwin

package wifi

import (
	"context"
	"os/exec"
)

func hide(*exec.Cmd) {}

func current(context.Context) (Network, error) { return Network{}, ErrUnsupported }

package core

import (
	"fmt"
	"os"
	"os/exec"
)

// elevateAndRun launches the core service as root through polkit. Running the
// GUI itself as root is deliberately not supported.
func elevateAndRun(executable string, args []string) error {
	if os.Geteuid() == 0 {
		return startDetached(executable, args)
	}

	pkexec, err := exec.LookPath("pkexec")
	if err != nil {
		return fmt.Errorf(
			"pkexec was not found; install polkit or start NuggetVPN from a session that can create TUN interfaces")
	}
	return startDetached(pkexec, append([]string{executable}, args...))
}

func startDetached(name string, args []string) error {
	command := exec.Command(name, args...)
	devNull, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err == nil {
		defer devNull.Close()
		command.Stdin, command.Stdout, command.Stderr = devNull, devNull, devNull
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("failed to start the privileged core service: %w", err)
	}
	// The service outlives this call; reap the shim so it does not linger.
	go func() { _ = command.Wait() }()
	return nil
}

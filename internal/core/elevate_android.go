//go:build android

package core

import (
	"errors"
	"flag"
)

// elevateAndRun starts the core service in this process. Android has no
// administrator to ask: the app holds the tunnel through VpnService, which
// it is granted once, so the service runs beside the window, reached over
// the same socket and protocol as on the desktop.
func elevateAndRun(_ string, args []string) error {
	flags := flag.NewFlagSet("core-service", flag.ContinueOnError)
	flags.Bool("core-service", true, "")
	socket := flags.String("socket", "", "")
	tokenFile := flags.String("token-file", "", "")
	flags.Int("uid", -1, "")
	flags.Int("gid", -1, "")
	flags.Int("parent", 0, "")
	if err := flags.Parse(args); err != nil {
		return err
	}
	token, err := ReadTokenFile(*tokenFile)
	if err != nil {
		return err
	}
	if token == "" {
		return errors.New("no control token")
	}
	go func() {
		// The window's own process: no owner to hand the socket to, and no
		// parent to watch.
		_ = RunService(ServiceOptions{SocketPath: *socket, Token: token, OwnerUID: -1, OwnerGID: -1})
	}()
	return nil
}

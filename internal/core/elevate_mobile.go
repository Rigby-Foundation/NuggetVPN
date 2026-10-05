//go:build android || ios

package core

import (
	"errors"
	"flag"
	"log"
)

// elevateAndRun starts the core service in this process. Mobile platforms (Android
// and iOS) have no administrator prompt / osascript: the app service runs beside
// the window in-process, reached over the same socket and protocol as on the desktop.
func elevateAndRun(_ string, args []string) error {
	flags := flag.NewFlagSet("core-service", flag.ContinueOnError)
	flags.Bool("core-service", true, "")
	socket := flags.String("socket", "", "")
	tokenFile := flags.String("token-file", "", "")
	flags.Int("uid", -1, "")
	flags.Int("gid", -1, "")
	flags.Int("parent", 0, "")
	version := flags.String("version", "", "")
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
		if err := RunService(ServiceOptions{
			SocketPath: *socket,
			Token:      token,
			Version:    *version,
			OwnerUID:   -1,
			OwnerGID:   -1,
		}); err != nil {
			log.Printf("core service error: %v", err)
		}
	}()
	return nil
}

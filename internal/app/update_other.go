//go:build !windows && (!darwin || ios)

package app

import "errors"

// installDownloaded has nothing to do here: only Windows and macOS install
// updates themselves, and CheckForUpdate offers it only there.
func (a *App) installDownloaded(string) error {
	return errors.New("no installer for this system; download it from the release page")
}

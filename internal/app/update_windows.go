package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
)

// installDownloaded runs the downloaded installer over this copy and quits.
//
// It goes through ShellExecute rather than CreateProcess: the installer asks
// for administrator rights in its manifest, and CreateProcess refuses such a
// program outright ("The requested operation requires elevation") where
// ShellExecute shows the UAC prompt for it.
//
// The installer runs silently (/S) into the folder this copy is in (/D, which
// NSIS requires last and unquoted), and /relaunch has it start the app again
// when it is done; see build/windows/nsis/project.nsi.
func (a *App) installDownloaded(installer string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	parameters := "/S /relaunch /D=" + filepath.Dir(executable)

	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(installer)
	if err != nil {
		return err
	}
	arguments, err := windows.UTF16PtrFromString(parameters)
	if err != nil {
		return err
	}
	if err := windows.ShellExecute(0, verb, file, arguments, nil, windows.SW_SHOWNORMAL); err != nil {
		if errors.Is(err, windows.ERROR_CANCELLED) {
			return errors.New("the update needs administrator approval; it was not given")
		}
		return fmt.Errorf("could not start the installer: %w", err)
	}

	// The installer replaces this program's files, and the service's, which
	// run from the same one; both have to be out of its way. Quitting stops
	// the service too (ServiceShutdown), and the installer waits for that.
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.QuitApp()
	}()
	return nil
}

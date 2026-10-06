//go:build darwin && !ios

package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// installDownloaded puts the app from the downloaded disk image in place of
// this one, then quits and starts the new copy.
//
// Opening the image and leaving the user to drag the app over the old one
// was the previous way, and is not an update so much as instructions for
// one. Here the image is mounted out of sight, the new bundle copied beside
// the running one and swapped in. A running app can have its bundle replaced
// under it: the process keeps the files it has open.
//
// When this copy is not inside an .app bundle (a development run), there is
// nothing to replace, and the image is opened as before.
func (a *App) installDownloaded(image string) error {
	bundle := runningBundle()
	if bundle == "" {
		if err := exec.Command("open", image).Start(); err != nil {
			return fmt.Errorf("could not open the disk image: %w", err)
		}
		return nil
	}

	mount, err := os.MkdirTemp("", "nuggetvpn-update-")
	if err != nil {
		return err
	}
	defer os.Remove(mount)
	attach := exec.Command("hdiutil", "attach", "-nobrowse", "-noautoopen", "-readonly", "-quiet", "-mountpoint", mount, image)
	if output, err := attach.CombinedOutput(); err != nil {
		return fmt.Errorf("could not open the disk image: %v: %s", err, strings.TrimSpace(string(output)))
	}
	defer exec.Command("hdiutil", "detach", "-force", "-quiet", mount).Run()

	matches, _ := filepath.Glob(filepath.Join(mount, "*.app"))
	if len(matches) == 0 {
		return errors.New("the disk image has no app in it")
	}

	if err := replaceBundle(matches[0], bundle); err != nil {
		return err
	}
	if err := relaunchAfterExit(bundle); err != nil {
		return fmt.Errorf("updated, but could not restart: %w", err)
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		a.QuitApp()
	}()
	return nil
}

// runningBundle is the .app this program runs from, or "" outside one.
func runningBundle() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	// <bundle>.app/Contents/MacOS/<binary>
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
	if !strings.HasSuffix(bundle, ".app") {
		return ""
	}
	return bundle
}

// replaceBundle copies source beside target and swaps it in, so a failure
// part-way leaves the old app whole. In a folder the user cannot write to,
// such as /Applications for a standard account, the same steps run with
// administrator rights, which macOS asks for in its own dialog.
func replaceBundle(source, target string) error {
	staged := target + ".update"
	retired := target + ".old"
	script := strings.Join([]string{
		"set -e",
		"rm -rf " + shellQuote(staged) + " " + shellQuote(retired),
		"ditto " + shellQuote(source) + " " + shellQuote(staged),
		"mv " + shellQuote(target) + " " + shellQuote(retired),
		"mv " + shellQuote(staged) + " " + shellQuote(target) + " || { mv " + shellQuote(retired) + " " + shellQuote(target) + "; exit 1; }",
		"rm -rf " + shellQuote(retired),
	}, "\n")

	if writable(filepath.Dir(target)) && writable(target) {
		if output, err := exec.Command("/bin/sh", "-c", script).CombinedOutput(); err != nil {
			return fmt.Errorf("could not replace the app: %v: %s", err, strings.TrimSpace(string(output)))
		}
		return nil
	}

	apple := "do shell script " + appleQuote(script) + " with administrator privileges"
	if output, err := exec.Command("osascript", "-e", apple).CombinedOutput(); err != nil {
		if strings.Contains(string(output), "-128") {
			return errors.New("the update needs administrator approval; it was not given")
		}
		return fmt.Errorf("could not replace the app: %v: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

// relaunchAfterExit starts the bundle again once this process has gone. Not
// sooner: the app lets only one copy run, so a new one started while this
// is still quitting would hand over to it and exit.
func relaunchAfterExit(bundle string) error {
	script := "while kill -0 " + strconv.Itoa(os.Getpid()) + " 2>/dev/null; do sleep 0.2; done; open " + shellQuote(bundle)
	command := exec.Command("/bin/sh", "-c", script)
	// Its own session, so it is not taken down with this process.
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return command.Start()
}

// writable reports whether this user can change path.
func writable(path string) bool {
	return syscall.Access(path, 0x2 /* W_OK */) == nil
}

// shellQuote quotes a value for sh.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// appleQuote quotes a value as an AppleScript string.
func appleQuote(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

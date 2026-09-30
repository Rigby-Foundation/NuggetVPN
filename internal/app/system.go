package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

type IPInfo struct {
	IP     string `json:"ip"`
	Region string `json:"region"`
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

// CheckIP looks up the public address the traffic is leaving from.
//
// This is a request to a third party, which is worth being deliberate about in
// a privacy tool, so it is behind a setting the user can switch off, and it
// runs here rather than in the renderer where it could not be governed.
func (a *App) CheckIP() (IPInfo, error) {
	_, settings := a.snapshot()
	if !settings.IPCheckOn() {
		return IPInfo{}, fmt.Errorf("the public address check is turned off in settings")
	}

	request, err := http.NewRequestWithContext(a.context(), http.MethodGet, "https://ipinfo.io/json", nil)
	if err != nil {
		return IPInfo{}, err
	}
	response, err := a.http.Do(request)
	if err != nil {
		return IPInfo{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return IPInfo{}, fmt.Errorf("address lookup returned %d", response.StatusCode)
	}

	var payload struct {
		IP     string `json:"ip"`
		Region string `json:"region"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return IPInfo{}, err
	}
	if payload.IP == "" {
		return IPInfo{}, fmt.Errorf("address lookup returned no address")
	}
	return IPInfo{IP: payload.IP, Region: payload.Region}, nil
}

// GetCurrentPlatform reports the host OS.
//
// The UI switches window chrome on the literal string "macos", which is what
// the previous Rust backend reported; Go spells the same platform "darwin".
func (a *App) GetCurrentPlatform() string {
	if runtime.GOOS == "darwin" {
		return "macos"
	}
	return runtime.GOOS
}

// OpenLogsFolder reveals the log directory in the system file manager.
func (a *App) OpenLogsFolder() error {
	directory := storage.LogDir()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}

	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", directory)
	case "windows":
		command = exec.Command("explorer", directory)
	default:
		command = exec.Command("xdg-open", directory)
	}
	return command.Start()
}

// ShowSaveDialog asks the user where to write a file and returns the chosen
// path, or an empty string when the dialog is cancelled.
func (a *App) ShowSaveDialog(defaultFilename string) (string, error) {
	if a.app == nil {
		return "", fmt.Errorf("application is not ready")
	}
	dialog := a.app.Dialog.SaveFile().
		SetMessage("Save file").
		CanCreateDirectories(true)
	if defaultFilename != "" {
		dialog = dialog.SetFilename(defaultFilename)
	}
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}
	return dialog.PromptForSingleSelection()
}

// WriteTextFile writes UTF-8 text to an absolute path the user picked.
func (a *App) WriteTextFile(path, contents string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("no path selected")
	}
	return os.WriteFile(path, []byte(contents), 0o644)
}

// SelectApplications opens a picker for the split-tunnelling app list.
func (a *App) SelectApplications() ([]string, error) {
	if a.app == nil {
		return nil, fmt.Errorf("application is not ready")
	}
	dialog := a.app.Dialog.OpenFile().
		SetTitle("Select applications").
		CanChooseFiles(true).
		ResolvesAliases(true).
		// macOS app bundles are directories; selecting one must yield the
		// bundle path rather than descending into it.
		TreatsFilePackagesAsDirectories(false).
		AddFilter("Applications", "*.app;*.exe")
	if a.window != nil {
		dialog = dialog.AttachToWindow(a.window)
	}

	paths, err := dialog.PromptForMultipleSelection()
	if err != nil {
		return nil, err
	}
	if paths == nil {
		return []string{}, nil
	}
	return paths, nil
}

// RequestClose implements the window close button: the window hides and the
// tunnel keeps running, because the tray icon is how the user gets back.
func (a *App) RequestClose() {
	a.closeWindow()
}

// QuitApp exits the application, stopping the tunnel on the way out.
func (a *App) QuitApp() {
	a.quitting = true
	if a.app != nil {
		a.app.Quit()
	}
}

// MinimiseWindow minimises the main window.
func (a *App) MinimiseWindow() {
	if a.window != nil {
		a.window.Minimise()
	}
}

// ToggleMaximiseWindow toggles the maximised state of the main window.
func (a *App) ToggleMaximiseWindow() {
	if a.window != nil {
		a.window.ToggleMaximise()
	}
}

// ShowWindow reveals and focuses the main window.
func (a *App) ShowWindow() {
	if a.window == nil {
		return
	}
	// Closed with "hide completely", the tray icon went too.
	if a.tray != nil {
		a.tray.Show()
	}
	// A window minimised to the taskbar is shown already; it needs restoring,
	// or a second launch would appear to do nothing.
	if a.window.IsMinimised() {
		a.window.UnMinimise()
	}
	a.window.Show()
	a.window.Focus()
}

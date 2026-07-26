package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/probe"
	"github.com/Rigby-Foundation/NuggetVPN/internal/remote"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

const (
	// mixedPort exposes a local HTTP/SOCKS proxy alongside the TUN interface.
	mixedPort = 7890
	// clashAPIListen backs the live traffic counters.
	clashAPIListen = "127.0.0.1:9090"
	// logEventName matches the event the frontend already subscribes to.
	logEventName = "vpn-log"
)

// App is bound to the frontend; every exported method is callable from JS.
type App struct {
	ctx context.Context

	// app and window are set by attach once the Wails application exists.
	app    *application.App
	window *application.WebviewWindow
	// quitting tells the window-close hook to stop swallowing the close.
	quitting bool

	mu       sync.Mutex
	profiles []models.Profile
	settings models.AppSettings
	running  bool

	core   *core.Client
	remote *remote.Client
	http   *http.Client

	logMu   sync.Mutex
	logFile *os.File
}

// attach hands the service the application and window handles it needs for
// events, dialogs and window control.
func (a *App) attach(app *application.App, window *application.WebviewWindow) {
	a.app = app
	a.window = window
}

// NewApp loads persisted state and prepares the core client.
func NewApp(version string) *App {
	_ = storage.EnsureDirs()

	app := &App{
		profiles: storage.LoadProfiles(link.DecodeProfileName),
		settings: storage.LoadSettings(),
		core:     core.NewClient(storage.ControlSocketPath(), version),
		remote:   remote.NewClient(),
		http:     &http.Client{Timeout: 3 * time.Second},
	}
	app.settings.Normalize()
	return app
}

// ServiceStartup is the Wails service lifecycle hook, called once during
// application startup.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx

	a.core.OnLog(func(level, message string) {
		a.appendLog(fmt.Sprintf("%s %s", strings.ToUpper(level), message))
	})
	a.core.OnState(func(running bool) {
		a.mu.Lock()
		a.running = running
		a.mu.Unlock()
		a.emit("vpn-state", running)
	})
	return nil
}

// ServiceShutdown stops the tunnel and the privileged service when the GUI
// exits, so no root process is left holding the system routes.
func (a *App) ServiceShutdown() error {
	a.core.Shutdown()

	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile != nil {
		_ = a.logFile.Close()
		a.logFile = nil
	}
	return nil
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

func (a *App) appendLog(lines ...string) {
	if len(lines) == 0 {
		return
	}
	a.emit(logEventName, lines)

	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logFile == nil {
		file, err := os.OpenFile(storage.LogPath(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return
		}
		a.logFile = file
	}
	for _, line := range lines {
		_, _ = a.logFile.WriteString(line + "\n")
	}
}

func (a *App) emit(name string, payload ...any) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(name, payload...)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

func (a *App) snapshot() ([]models.Profile, models.AppSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	profiles := make([]models.Profile, len(a.profiles))
	copy(profiles, a.profiles)
	return profiles, a.settings
}

func (a *App) replaceProfiles(profiles []models.Profile) []models.Profile {
	a.mu.Lock()
	a.profiles = profiles
	snapshot := make([]models.Profile, len(profiles))
	copy(snapshot, profiles)
	a.mu.Unlock()

	_ = storage.SaveProfiles(snapshot)
	return snapshot
}

// GetProfiles returns every saved profile.
func (a *App) GetProfiles() []models.Profile {
	profiles, _ := a.snapshot()
	return profiles
}

// AddProfile stores a hand-entered link. An empty name is derived from the link.
func (a *App) AddProfile(name, configLink string) ([]models.Profile, error) {
	trimmed := strings.TrimSpace(configLink)
	if trimmed == "" {
		return nil, fmt.Errorf("a config link is required")
	}

	resolved := strings.TrimSpace(name)
	if resolved == "" {
		resolved = link.ExtractName(trimmed)
	}
	zero := uint64(0)

	profiles, _ := a.snapshot()
	profiles = append(profiles, models.Profile{
		ID:           uuid.NewString(),
		Name:         resolved,
		Server:       "Auto",
		Protocol:     link.DetectProtocol(trimmed),
		ConfigLink:   trimmed,
		SourceDomain: "local",
		TotalUp:      &zero,
		TotalDown:    &zero,
	})
	return a.replaceProfiles(profiles), nil
}

// DeleteProfile removes one profile by id.
func (a *App) DeleteProfile(id string) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	kept := profiles[:0]
	for _, profile := range profiles {
		if profile.ID != id {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// DeleteProfilesBySource removes every profile from one subscription.
func (a *App) DeleteProfilesBySource(sourceDomain string) ([]models.Profile, error) {
	target := strings.TrimSpace(sourceDomain)
	profiles, _ := a.snapshot()
	kept := profiles[:0]
	for _, profile := range profiles {
		if profile.NormalizedSourceDomain() != target {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// DeleteProfilesByIds removes a batch of profiles.
func (a *App) DeleteProfilesByIds(ids []string) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	if len(ids) == 0 {
		return profiles, nil
	}
	remove := make(map[string]bool, len(ids))
	for _, id := range ids {
		remove[id] = true
	}
	kept := profiles[:0]
	for _, profile := range profiles {
		if !remove[profile.ID] {
			kept = append(kept, profile)
		}
	}
	return a.replaceProfiles(kept), nil
}

// UpdateProfileUsage accumulates transferred bytes for a profile.
func (a *App) UpdateProfileUsage(id string, up, down uint64) error {
	a.mu.Lock()
	for index := range a.profiles {
		if a.profiles[index].ID != id {
			continue
		}
		total := uint64(0)
		if a.profiles[index].TotalUp != nil {
			total = *a.profiles[index].TotalUp
		}
		total += up
		a.profiles[index].TotalUp = &total

		totalDown := uint64(0)
		if a.profiles[index].TotalDown != nil {
			totalDown = *a.profiles[index].TotalDown
		}
		totalDown += down
		a.profiles[index].TotalDown = &totalDown
		break
	}
	snapshot := make([]models.Profile, len(a.profiles))
	copy(snapshot, a.profiles)
	a.mu.Unlock()

	return storage.SaveProfiles(snapshot)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GetSettings returns the persisted settings.
func (a *App) GetSettings() models.AppSettings {
	_, settings := a.snapshot()
	return settings
}

// SaveSettings persists settings coming from the UI.
func (a *App) SaveSettings(settings models.AppSettings) error {
	settings.Normalize()

	a.mu.Lock()
	a.settings = settings
	a.mu.Unlock()

	return storage.SaveSettings(settings)
}

// ---------------------------------------------------------------------------
// VPN lifecycle
// ---------------------------------------------------------------------------

// StartVPN generates a sing-box config for the selected profile and hands it to
// the privileged core service.
func (a *App) StartVPN(profileID string) (string, error) {
	profiles, settings := a.snapshot()
	if len(profiles) == 0 {
		return "", fmt.Errorf("no profiles found")
	}

	selected := profiles[0]
	if trimmed := strings.TrimSpace(profileID); trimmed != "" {
		found := false
		for _, profile := range profiles {
			if profile.ID == trimmed {
				selected, found = profile, true
				break
			}
		}
		if !found {
			return "", fmt.Errorf("profile not found")
		}
	}

	result, err := sbconfig.Build(sbconfig.Request{
		Profile:        selected,
		Profiles:       profiles,
		Settings:       settings,
		MixedPort:      mixedPort,
		ClashAPIListen: clashAPIListen,
		CacheFilePath:  filepath.Join(storage.RuntimeDir(), "cache.db"),
	})
	if err != nil {
		return "", err
	}

	// Mirror the config to disk purely so users can inspect what ran.
	_ = os.WriteFile(storage.CoreConfigPath(), result.JSON, 0o600)

	a.appendLog(fmt.Sprintf("Starting %s (%s)", selected.Name, selected.Protocol))
	if result.Verbatim {
		a.appendLog("Using the profile's own sing-box config verbatim")
	} else {
		mode := "full tunnel"
		if settings.SplitTunnelling() {
			mode = fmt.Sprintf("split tunnel (%s, %d rules)", settings.RoutingMode, result.SplitRules)
		}
		a.appendLog("Routing mode: " + mode)
		if result.ChainHops > 0 {
			a.appendLog(fmt.Sprintf("Proxy chain: %d hop(s) before the exit", result.ChainHops))
		}
	}

	if err := a.core.Start(result.JSON); err != nil {
		a.appendLog("Failed to start: " + err.Error())
		return "", err
	}

	a.mu.Lock()
	a.running = true
	a.mu.Unlock()

	return "VPN Started", nil
}

// StopVPN tears the tunnel down, leaving the privileged service running so the
// next connection does not need another password prompt.
func (a *App) StopVPN() (string, error) {
	if err := a.core.Stop(); err != nil {
		return "", err
	}
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()

	a.appendLog("VPN stopped")
	return "VPN Stopped", nil
}

// IsRunning reports whether the tunnel is up.
func (a *App) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

// TrafficStats are cumulative byte counters for the current session.
type TrafficStats struct {
	Up   uint64 `json:"up"`
	Down uint64 `json:"down"`
}

// GetTraffic reads the live counters from the core's Clash-compatible API.
// It returns zeroes rather than an error when the tunnel is down, so the UI can
// poll it unconditionally.
func (a *App) GetTraffic() TrafficStats {
	if !a.IsRunning() {
		return TrafficStats{}
	}
	response, err := a.http.Get("http://" + clashAPIListen + "/connections")
	if err != nil {
		return TrafficStats{}
	}
	defer response.Body.Close()

	var payload struct {
		DownloadTotal uint64 `json:"downloadTotal"`
		UploadTotal   uint64 `json:"uploadTotal"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return TrafficStats{}
	}
	return TrafficStats{Up: payload.UploadTotal, Down: payload.DownloadTotal}
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

// PingProfiles measures ICMP latency for one subscription's profiles.
func (a *App) PingProfiles(sourceDomain string) []probe.ProfilePing {
	profiles, settings := a.snapshot()
	results := probe.Ping(profiles, settings, sourceDomain)
	if results == nil {
		return []probe.ProfilePing{}
	}
	return results
}

// ProbeProfilesConnectivity measures TCP handshake latency, which works where
// ICMP is filtered.
func (a *App) ProbeProfilesConnectivity(
	sourceDomain string,
	profileIDs []string,
	timeoutMS uint64,
) []probe.ProfilePing {
	profiles, settings := a.snapshot()
	results := probe.Connectivity(profiles, settings, sourceDomain, profileIDs, timeoutMS)
	if results == nil {
		return []probe.ProfilePing{}
	}
	return results
}

// ---------------------------------------------------------------------------
// Subscriptions and sync
// ---------------------------------------------------------------------------

// ImportSubscription fetches a subscription URL and adds its profiles.
func (a *App) ImportSubscription(url string) ([]models.Profile, error) {
	profiles, _ := a.snapshot()
	updated, err := a.remote.ImportSubscription(a.context(), profiles, url)
	if err != nil {
		return nil, err
	}
	return a.replaceProfiles(updated), nil
}

// RefreshSubscriptionsOnStartup re-fetches every saved subscription.
func (a *App) RefreshSubscriptionsOnStartup() (remote.RefreshSummary, error) {
	profiles, _ := a.snapshot()
	updated, summary, err := a.remote.RefreshSubscriptions(a.context(), profiles, "")
	if err != nil {
		return summary, err
	}
	a.replaceProfiles(updated)
	return summary, nil
}

// RefreshSubscriptionByDomain re-fetches a single subscription.
func (a *App) RefreshSubscriptionByDomain(sourceDomain string) (remote.RefreshSummary, error) {
	profiles, _ := a.snapshot()
	updated, summary, err := a.remote.RefreshSubscriptions(a.context(), profiles, sourceDomain)
	if err != nil {
		return summary, err
	}
	a.replaceProfiles(updated)
	return summary, nil
}

// LoginUser authenticates against the profile sync server.
func (a *App) LoginUser(server, username, password string) (string, error) {
	return a.remote.Login(a.context(), server, username, password)
}

// RegisterUser creates an account on the profile sync server.
func (a *App) RegisterUser(server, username, password string) (string, error) {
	return a.remote.Register(a.context(), server, username, password)
}

// PushProfilesToServer uploads local profiles.
func (a *App) PushProfilesToServer(settings models.AppSettings) (string, error) {
	profiles, _ := a.snapshot()
	return a.remote.PushProfiles(a.context(), settings, profiles)
}

// PullProfilesFromServer replaces local profiles with the server's copy.
func (a *App) PullProfilesFromServer(settings models.AppSettings) ([]models.Profile, error) {
	profiles, err := a.remote.PullProfiles(a.context(), settings)
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return a.GetProfiles(), nil
	}
	return a.replaceProfiles(profiles), nil
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

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
	if a.window != nil {
		a.window.Hide()
	}
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
	if a.window != nil {
		a.window.Show()
		a.window.Focus()
	}
}

func (a *App) context() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

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
	"sort"
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
	// logEventName matches the event the frontend subscribes to.
	logEventName = "vpn-log"
	// stateEventName carries the whole connection state, not just a boolean, so
	// the UI can distinguish connecting from connected from failed.
	stateEventName = "vpn-state"
	// trafficEventName carries a byte-counter sample once a second.
	trafficEventName = "vpn-traffic"

	// probeCandidates bounds how many servers get a TCP reachability check
	// before connecting; the ICMP sweep has already ranked them by then.
	probeCandidates = 8
	// probeTimeoutMS is the per-server budget for that check.
	probeTimeoutMS = 1200
	// usagePersistInterval is how often accumulated bytes are written to
	// profiles.json. Every sample would mean a disk write per second.
	usagePersistInterval = 5 * time.Second
)

// Connection status values reported to the UI.
const (
	StatusIdle       = "idle"
	StatusConnecting = "connecting"
	StatusConnected  = "connected"
	StatusError      = "error"
)

// Proxy selection modes accepted by Connect.
const (
	ModeAuto   = "auto"
	ModeManual = "manual"
)

// ConnectionState is the single source of truth the UI renders from.
//
// It replaced a bare "is it running" boolean: a VPN client that cannot tell
// "connecting" from "connected", or notice that the tunnel died, shows the user
// a padlock that is not there.
type ConnectionState struct {
	Status    string `json:"status"`
	ProfileID string `json:"profile_id,omitempty"`
	Profile   string `json:"profile,omitempty"`
	Error     string `json:"error,omitempty"`
	// Since is the unix millisecond timestamp the tunnel came up, so the UI can
	// render a duration without keeping its own timer honest.
	Since int64 `json:"since,omitempty"`
}

// TrafficSample is one second of byte counters.
type TrafficSample struct {
	Up        uint64 `json:"up"`
	Down      uint64 `json:"down"`
	UpRate    uint64 `json:"up_rate"`
	DownRate  uint64 `json:"down_rate"`
	TotalUp   uint64 `json:"total_up"`
	TotalDown uint64 `json:"total_down"`
}

// IPInfo is the result of the optional public-address lookup.
type IPInfo struct {
	IP     string `json:"ip"`
	Region string `json:"region"`
}

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
	state    ConnectionState

	// connectMu serialises Connect and Disconnect so two clicks cannot race a
	// half-finished failover sweep.
	connectMu sync.Mutex

	core   *core.Client
	remote *remote.Client
	http   *http.Client

	trafficMu     sync.Mutex
	traffic       TrafficSample
	trafficBase   struct{ up, down uint64 }
	pendingUp     uint64
	pendingDown   uint64
	lastPersisted time.Time

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
		core: core.NewClient(
			storage.ControlSocketPath(),
			storage.ControlTokenPath(),
			version,
		),
		remote: remote.NewClient(),
		http:   &http.Client{Timeout: 8 * time.Second},
		state:  ConnectionState{Status: StatusIdle},
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
	a.core.OnState(a.handleCoreState)
	a.core.OnStats(a.handleCoreStats)
	return nil
}

// ServiceShutdown stops the tunnel and the privileged service when the GUI
// exits, so no root process is left holding the system routes.
func (a *App) ServiceShutdown() error {
	a.flushUsage()
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

// LogBatch is the payload of a vpn-log event. It is a struct rather than a
// bare slice so the renderer never has to guess whether the runtime handed it
// one argument that is a list, or a list of arguments.
type LogBatch struct {
	Lines []string `json:"lines"`
}

func (a *App) appendLog(lines ...string) {
	if len(lines) == 0 {
		return
	}
	a.emit(logEventName, LogBatch{Lines: lines})

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
// Connection state
// ---------------------------------------------------------------------------

// setState records the new state and tells the UI. Every transition goes
// through here so the event and the state can never disagree.
func (a *App) setState(state ConnectionState) ConnectionState {
	a.mu.Lock()
	a.state = state
	a.mu.Unlock()

	a.emit(stateEventName, state)
	return state
}

// GetConnectionState returns the current connection state. The UI calls it once
// on startup to reconcile; after that it follows the vpn-state event.
func (a *App) GetConnectionState() ConnectionState {
	a.mu.Lock()
	state := a.state
	a.mu.Unlock()

	// Reconcile with the core, which is the real authority: the GUI may have
	// been reloaded, or the tunnel may have died while nobody was listening.
	running := a.core.Running()
	switch {
	case running && state.Status != StatusConnected:
		state.Status = StatusConnected
		if state.Since == 0 {
			state.Since = time.Now().UnixMilli()
		}
		return a.setState(state)
	case !running && state.Status == StatusConnected:
		return a.setState(ConnectionState{Status: StatusIdle})
	}
	return state
}

// handleCoreState reacts to the core reporting that the tunnel went up or down
// on its own. A tunnel that drops without the UI noticing is the failure mode
// this exists to prevent.
func (a *App) handleCoreState(running bool) {
	a.mu.Lock()
	state := a.state
	a.mu.Unlock()

	if running {
		// Connect drives its own transitions; a start it triggered is already
		// reflected. This only matters for a state change we did not ask for.
		if state.Status == StatusConnected {
			return
		}
		state.Status = StatusConnected
		state.Error = ""
		if state.Since == 0 {
			state.Since = time.Now().UnixMilli()
		}
		a.setState(state)
		return
	}

	// A drop while connecting is just a failed attempt; the failover loop is
	// still working through its candidates and will report the outcome.
	if state.Status == StatusConnecting {
		return
	}
	if state.Status == StatusIdle {
		return
	}

	a.flushUsage()
	a.resetTraffic()
	a.appendLog("The tunnel stopped unexpectedly")
	a.setState(ConnectionState{
		Status: StatusError,
		Error:  "The connection dropped.",
	})
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

// Connect brings the tunnel up for one configuration source.
//
// sourceDomain selects a subscription (or "local" for hand-added profiles),
// mode is "auto" or "manual", and profileID pins a specific server in manual
// mode. The candidate ordering, reachability probing and retry-on-failure that
// this performs used to live in the click handler in the renderer; it is real
// product logic, it is the thing users notice when it is wrong, and here it can
// be tested and can report progress as it goes.
func (a *App) Connect(sourceDomain, mode, profileID string) (ConnectionState, error) {
	a.connectMu.Lock()
	defer a.connectMu.Unlock()

	profiles, settings := a.snapshot()
	if len(profiles) == 0 {
		return a.fail("No profiles found. Add a profile or import a subscription.")
	}

	plan, err := a.planConnection(profiles, settings, sourceDomain, mode, profileID)
	if err != nil {
		return a.fail(err.Error())
	}

	a.setState(ConnectionState{Status: StatusConnecting})
	a.resetTraffic()

	var lastErr error
	for index, candidate := range plan.order {
		profile, ok := profileByID(profiles, candidate)
		if !ok {
			continue
		}

		if len(plan.order) > 1 {
			a.appendLog(fmt.Sprintf("Trying %s (%d of %d)",
				profile.Name, index+1, len(plan.order)))
		}
		a.setState(ConnectionState{
			Status:    StatusConnecting,
			ProfileID: profile.ID,
			Profile:   profile.Name,
		})

		if err := a.startProfile(profile, profiles, settings); err != nil {
			lastErr = err
			a.appendLog(fmt.Sprintf("%s failed: %v", profile.Name, err))
			if !plan.resilient {
				return a.fail(err.Error())
			}
			continue
		}

		a.beginSession(profile.ID)
		return a.setState(ConnectionState{
			Status:    StatusConnected,
			ProfileID: profile.ID,
			Profile:   profile.Name,
			Since:     time.Now().UnixMilli(),
		}), nil
	}

	if lastErr != nil {
		return a.fail(fmt.Sprintf("No working server found (last error: %v).", lastErr))
	}
	return a.fail("No proxy available for this configuration.")
}

// Disconnect tears the tunnel down, leaving the privileged service running so
// the next connection does not need another password prompt.
func (a *App) Disconnect() (ConnectionState, error) {
	a.connectMu.Lock()
	defer a.connectMu.Unlock()

	a.flushUsage()

	// Go idle *before* asking the core to stop. Stopping makes the core
	// broadcast that the tunnel is down, and that event races the reply to this
	// very call; if it arrived while the state still said "connected" it would
	// be read as an unexpected drop and reported to the user as a failure.
	// handleCoreState ignores a down event once the state is already idle.
	state := a.setState(ConnectionState{Status: StatusIdle})

	if err := a.core.Stop(); err != nil {
		return a.setState(ConnectionState{Status: StatusError, Error: err.Error()}), err
	}
	a.resetTraffic()
	a.appendLog("VPN stopped")
	return state, nil
}

// fail records an error state and returns it as both value and error, so the
// caller in the UI can render either.
func (a *App) fail(message string) (ConnectionState, error) {
	return a.setState(ConnectionState{Status: StatusError, Error: message}),
		fmt.Errorf("%s", message)
}

// connectionPlan is the ordered list of servers to try.
type connectionPlan struct {
	order []string
	// resilient means a failing server is skipped rather than surfaced. It is
	// off when the user pinned one specific server, because silently connecting
	// them somewhere else would be a lie.
	resilient bool
}

// planConnection ranks the servers to attempt.
func (a *App) planConnection(
	profiles []models.Profile,
	settings models.AppSettings,
	sourceDomain, mode, profileID string,
) (connectionPlan, error) {
	domain := strings.TrimSpace(sourceDomain)
	if domain == "" {
		domain = "local"
	}
	selected := strings.TrimSpace(profileID)

	chainActive := settings.ProxyChainEnabled && len(settings.ProxyChain) > 0
	inChain := map[string]bool{}
	if chainActive {
		for _, id := range settings.ProxyChain {
			inChain[id] = true
		}
	}

	var domainProfiles, eligible []models.Profile
	for _, profile := range profiles {
		if profile.NormalizedSourceDomain() != domain {
			continue
		}
		domainProfiles = append(domainProfiles, profile)
		if !inChain[profile.ID] {
			eligible = append(eligible, profile)
		}
	}
	if len(domainProfiles) == 0 {
		return connectionPlan{}, fmt.Errorf("no proxy available for this configuration")
	}

	// A server that is already a hop in the chain cannot also be the exit.
	if inChain[selected] {
		selected = ""
	}
	// Pinning an exit while chaining means the user chose it deliberately.
	forcedExit := chainActive && selected != ""

	candidates := eligible
	if len(candidates) == 0 {
		candidates = domainProfiles
	}

	if mode == ModeAuto && !forcedExit {
		order := a.rankByLatency(candidates, settings, domain)
		if len(order) == 0 {
			return connectionPlan{}, fmt.Errorf("no proxy available for this configuration")
		}
		return connectionPlan{order: order, resilient: true}, nil
	}

	if selected == "" {
		selected = candidates[0].ID
	}

	// Manual selection inside a subscription still falls back to its siblings:
	// subscription servers come and go, and a dead one should not strand the
	// user. A single hand-added profile has no siblings to fall back to.
	if mode == ModeManual && domain != "local" && !forcedExit {
		order := []string{selected}
		for _, profile := range candidates {
			if profile.ID != selected {
				order = append(order, profile.ID)
			}
		}
		return connectionPlan{order: order, resilient: true}, nil
	}
	return connectionPlan{order: []string{selected}}, nil
}

// rankByLatency sorts candidates fastest-first, using an ICMP sweep refined by
// a TCP handshake check on the leaders. ICMP is cheap but often filtered, so a
// server that answers a real TCP connect outranks one that only pings.
func (a *App) rankByLatency(
	candidates []models.Profile,
	settings models.AppSettings,
	domain string,
) []string {
	pings := map[string]uint64{}
	const unreachable = ^uint64(0)
	for _, result := range probe.Ping(candidates, settings, domain) {
		if result.PingMS != nil {
			pings[result.ID] = *result.PingMS
			continue
		}
		pings[result.ID] = unreachable
	}

	order := make([]string, 0, len(candidates))
	for _, profile := range candidates {
		order = append(order, profile.ID)
	}
	sort.SliceStable(order, func(i, j int) bool {
		left, ok := pings[order[i]]
		if !ok {
			left = unreachable
		}
		right, ok := pings[order[j]]
		if !ok {
			right = unreachable
		}
		return left < right
	})
	if len(order) < 2 {
		return order
	}

	limit := min(len(order), probeCandidates)
	results := probe.Connectivity(candidates, settings, domain, order[:limit], probeTimeoutMS)

	reachable := make([]string, 0, limit)
	seen := map[string]bool{}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].PingMS == nil {
			return false
		}
		if results[j].PingMS == nil {
			return true
		}
		return *results[i].PingMS < *results[j].PingMS
	})
	for _, result := range results {
		if result.PingMS == nil {
			continue
		}
		reachable = append(reachable, result.ID)
		seen[result.ID] = true
	}

	// Everything the TCP check could not reach keeps its ICMP ranking and goes
	// to the back, rather than being discarded: the check can be wrong.
	for _, id := range order {
		if !seen[id] {
			reachable = append(reachable, id)
		}
	}
	return reachable
}

// startProfile generates a config for one profile and hands it to the core.
func (a *App) startProfile(
	profile models.Profile,
	profiles []models.Profile,
	settings models.AppSettings,
) error {
	result, err := sbconfig.Build(sbconfig.Request{
		Profile:       profile,
		Profiles:      profiles,
		Settings:      settings,
		MixedPort:     mixedPort,
		CacheFilePath: filepath.Join(storage.RuntimeDir(), "cache.db"),
	})
	if err != nil {
		return err
	}

	// Mirror the config to disk purely so users can inspect what ran.
	_ = os.WriteFile(storage.CoreConfigPath(), result.JSON, 0o600)

	a.appendLog(fmt.Sprintf("Starting %s (%s)", profile.Name, profile.Protocol))
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

	return a.core.Start(result.JSON)
}

func profileByID(profiles []models.Profile, id string) (models.Profile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return models.Profile{}, false
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

// beginSession anchors the counters for a newly connected profile.
func (a *App) beginSession(profileID string) {
	totalUp, totalDown := a.profileTotals(profileID)

	a.trafficMu.Lock()
	defer a.trafficMu.Unlock()
	a.trafficBase.up, a.trafficBase.down = 0, 0
	a.pendingUp, a.pendingDown = 0, 0
	a.lastPersisted = time.Now()
	a.traffic = TrafficSample{TotalUp: totalUp, TotalDown: totalDown}
}

func (a *App) resetTraffic() {
	a.trafficMu.Lock()
	defer a.trafficMu.Unlock()
	a.traffic = TrafficSample{}
	a.trafficBase.up, a.trafficBase.down = 0, 0
	a.pendingUp, a.pendingDown = 0, 0
}

// handleCoreStats turns the core's cumulative counters into a session total and
// a per-second rate.
//
// The core pushes these; the UI used to poll for them every second, re-derive
// the rate in JavaScript and post increments back, which lost whatever had
// accumulated whenever it was reloaded between saves.
func (a *App) handleCoreStats(up, down int64) {
	if up < 0 || down < 0 {
		return
	}
	rawUp, rawDown := uint64(up), uint64(down)

	a.mu.Lock()
	profileID := a.state.ProfileID
	connected := a.state.Status == StatusConnected
	a.mu.Unlock()
	if !connected {
		return
	}

	a.trafficMu.Lock()
	// A restarted core counts from zero again; re-anchor instead of reporting a
	// negative delta.
	if rawUp < a.trafficBase.up || rawDown < a.trafficBase.down {
		a.trafficBase.up, a.trafficBase.down = rawUp, rawDown
	}
	sessionUp := rawUp - a.trafficBase.up
	sessionDown := rawDown - a.trafficBase.down

	sample := TrafficSample{
		Up:        sessionUp,
		Down:      sessionDown,
		UpRate:    saturatingSub(sessionUp, a.traffic.Up),
		DownRate:  saturatingSub(sessionDown, a.traffic.Down),
		TotalUp:   a.traffic.TotalUp + saturatingSub(sessionUp, a.traffic.Up),
		TotalDown: a.traffic.TotalDown + saturatingSub(sessionDown, a.traffic.Down),
	}
	a.pendingUp += sample.UpRate
	a.pendingDown += sample.DownRate
	a.traffic = sample
	persistDue := time.Since(a.lastPersisted) >= usagePersistInterval
	a.trafficMu.Unlock()

	a.emit(trafficEventName, sample)

	if persistDue {
		a.persistUsage(profileID)
	}
}

// GetTraffic returns the most recent sample. The UI follows the vpn-traffic
// event; this is for a caller that needs a value immediately, such as a fresh
// window attaching to a session already in progress.
func (a *App) GetTraffic() TrafficSample {
	a.trafficMu.Lock()
	defer a.trafficMu.Unlock()
	return a.traffic
}

// persistUsage folds the bytes accumulated since the last write into the
// profile and saves.
func (a *App) persistUsage(profileID string) {
	a.trafficMu.Lock()
	up, down := a.pendingUp, a.pendingDown
	a.pendingUp, a.pendingDown = 0, 0
	a.lastPersisted = time.Now()
	a.trafficMu.Unlock()

	if profileID == "" || (up == 0 && down == 0) {
		return
	}
	a.addProfileUsage(profileID, up, down)
}

// flushUsage writes out whatever has not been persisted yet. Called before the
// tunnel goes down and before the app exits, so a session's last few seconds
// are not lost.
func (a *App) flushUsage() {
	a.mu.Lock()
	profileID := a.state.ProfileID
	a.mu.Unlock()
	a.persistUsage(profileID)
}

func (a *App) profileTotals(profileID string) (up, down uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, profile := range a.profiles {
		if profile.ID != profileID {
			continue
		}
		if profile.TotalUp != nil {
			up = *profile.TotalUp
		}
		if profile.TotalDown != nil {
			down = *profile.TotalDown
		}
		return up, down
	}
	return 0, 0
}

// addProfileUsage accumulates transferred bytes for a profile.
func (a *App) addProfileUsage(id string, up, down uint64) {
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

	_ = storage.SaveProfiles(snapshot)
}

func saturatingSub(current, previous uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GetSettings returns the persisted settings.
func (a *App) GetSettings() models.AppSettings {
	_, settings := a.snapshot()
	return settings
}

// SaveSettings persists settings coming from the UI. Normalisation happens
// here, once, rather than being duplicated in the renderer.
func (a *App) SaveSettings(settings models.AppSettings) (models.AppSettings, error) {
	settings.Normalize()

	a.mu.Lock()
	a.settings = settings
	a.mu.Unlock()

	return settings, storage.SaveSettings(settings)
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

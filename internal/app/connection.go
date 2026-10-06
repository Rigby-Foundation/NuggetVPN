package app

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/probe"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/stats"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
	"os"
	"path/filepath"
)

type ConnectionState struct {
	Status    string `json:"status"`
	ProfileID string `json:"profile_id,omitempty"`
	Profile   string `json:"profile,omitempty"`
	Error     string `json:"error,omitempty"`
	// Since is the unix millisecond timestamp the tunnel came up, so the UI can
	// render a duration without keeping its own timer honest.
	Since int64 `json:"since,omitempty"`
	// Reconnecting is set while the app is bringing a dropped tunnel back;
	// Attempt counts the tries.
	Reconnecting bool `json:"reconnecting,omitempty"`
	Attempt      int  `json:"attempt,omitempty"`
	// Blocked means the kill switch is holding all traffic until the
	// tunnel is back, or the user disconnects.
	Blocked bool `json:"blocked,omitempty"`
}

// probeTimeoutMS is the per-server budget for the TCP check before
// connecting; see rankByLatency.
const probeTimeoutMS = 1200

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
	if a.lockedDown.Load() {
		return state
	}
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
		// The kill switch's lockdown also runs the core, and is not a
		// connection.
		if state.Status == StatusConnected || a.lockedDown.Load() {
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

	// The lockdown itself stopping means traffic is no longer held; there is
	// nothing to reconnect to, and the user should know.
	if a.lockedDown.Swap(false) {
		a.setState(ConnectionState{Status: StatusError, Error: "The kill switch stopped; traffic is no longer blocked."})
		return
	}

	a.flushUsage()
	a.resetTraffic()
	a.recordEvent(state.ProfileID, stats.KindDrop, false)
	a.appendLog("The tunnel stopped unexpectedly")
	a.notify(notifyDropped)

	_, settings := a.snapshot()
	a.mu.Lock()
	last := a.lastConnect
	a.mu.Unlock()
	if last.valid && settings.AutoReconnect != nil && *settings.AutoReconnect {
		go a.reconnect(a.connectGen.Load(), last, settings.KillSwitch)
		return
	}
	if settings.KillSwitch {
		a.engageLockdown()
	}
	a.setState(ConnectionState{
		Status:  StatusError,
		Error:   "The connection dropped.",
		Blocked: a.lockedDown.Load(),
	})
}

// connectRequest is what the user last connected with, so a dropped tunnel
// can be brought back the same way.
type connectRequest struct {
	valid                 bool
	source, mode, profile string
}

// reconnectDelays is how long to wait before each attempt: quickly at first,
// for a blip, then backing off so a long outage does not spin.
var reconnectDelays = []time.Duration{
	time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second,
	15 * time.Second, 30 * time.Second, 30 * time.Second, 60 * time.Second,
}

// reconnect brings a dropped tunnel back, trying the same configuration as
// the user's last connect — in automatic mode, that means the best server
// that answers now. Any connect or disconnect by the user bumps connectGen
// and ends it.
func (a *App) reconnect(generation uint64, last connectRequest, killSwitch bool) {
	if killSwitch {
		a.engageLockdown()
	}
	for attempt := 1; attempt <= len(reconnectDelays); attempt++ {
		if a.connectGen.Load() != generation {
			return
		}
		a.setState(ConnectionState{
			Status:       StatusConnecting,
			Reconnecting: true,
			Attempt:      attempt,
			Blocked:      a.lockedDown.Load(),
		})
		time.Sleep(reconnectDelays[attempt-1])
		if a.connectGen.Load() != generation {
			return
		}
		a.appendLog(fmt.Sprintf("Reconnecting (attempt %d of %d)", attempt, len(reconnectDelays)))
		if _, err := a.connect(last.source, last.mode, last.profile, generation); err == nil {
			a.notify(notifyReconnected)
			return
		}
	}
	if a.connectGen.Load() != generation {
		return
	}
	a.setState(ConnectionState{
		Status:  StatusError,
		Error:   "Could not reconnect.",
		Blocked: a.lockedDown.Load(),
	})
}

// engageLockdown runs the kill switch's lockdown config: the tunnel stays,
// and refuses everything but this app and the local network.
func (a *App) engageLockdown() {
	_, settings := a.snapshot()
	self, _ := os.Executable()
	config, err := sbconfig.Lockdown(settings, self)
	if err != nil {
		a.appendLog("WARN kill switch: " + err.Error())
		return
	}
	a.lockedDown.Store(true)
	if err := a.core.Start(config); err != nil {
		a.lockedDown.Store(false)
		a.appendLog("WARN kill switch could not block traffic: " + err.Error())
		return
	}
	a.appendLog("Kill switch: blocking all traffic until the tunnel is back")
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
	// A connect by the user supersedes any reconnect in progress.
	return a.connect(sourceDomain, mode, profileID, a.connectGen.Add(1))
}

// connect is Connect, for a given generation: a reconnect passes the one it
// started in, and gives up if the user has since connected or disconnected.
func (a *App) connect(sourceDomain, mode, profileID string, generation uint64) (ConnectionState, error) {
	a.connectMu.Lock()
	defer a.connectMu.Unlock()
	if a.connectGen.Load() != generation {
		return a.GetConnectionState(), fmt.Errorf("superseded")
	}

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

		alternatives := alternativesFor(plan, profiles, settings, mode, profile.ID)
		if err := a.startProfile(profile, profiles, settings, alternatives); err != nil {
			a.recordEvent(profile.ID, stats.KindConnect, false)
			lastErr = err
			a.appendLog(fmt.Sprintf("%s failed: %v", profile.Name, err))
			if !plan.resilient {
				return a.fail(err.Error())
			}
			continue
		}

		a.recordEvent(profile.ID, stats.KindConnect, true)
		a.beginSession(profile.ID)
		a.lockedDown.Store(false)
		a.mu.Lock()
		a.lastConnect = connectRequest{valid: true, source: sourceDomain, mode: mode, profile: profileID}
		a.alternatives = alternatives
		a.mu.Unlock()
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
	// Ends any reconnect in progress, and releases the kill switch: the user
	// asked for the tunnel to be down.
	a.connectGen.Add(1)
	a.connectMu.Lock()
	defer a.connectMu.Unlock()
	a.lockedDown.Store(false)
	a.mu.Lock()
	a.lastConnect = connectRequest{}
	a.mu.Unlock()

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
		// A server the chosen core cannot run is never worth trying; if
		// that rules out every one, candidates falls back below and the
		// core's own refusal is what the user sees.
		if !inChain[profile.ID] && checkProfile(settings, profile) == nil {
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

// rankBudget is how long connecting waits on measurements before it ranks
// with what it has. The probes used to run one after the other and to the
// end: an ICMP sweep of every server, two seconds for each that ignores ping
// (many do), then a TCP check of the leaders. Across a subscription of fifty
// that was ten seconds or more before the core even started.
const rankBudget = 1500 * time.Millisecond

// rankByLatency sorts candidates fastest-first. An ICMP sweep and a TCP
// handshake check run side by side over every candidate, and the ranking
// uses whatever is back within rankBudget: servers that completed a TCP
// handshake first, by its time, since that is a real connection; then those
// that only answered ping (a UDP-only protocol has no TCP listener); then the
// rest in their usual order. Nothing is discarded, because a probe can be
// wrong, and the plan falls back through the list anyway.
func (a *App) rankByLatency(
	candidates []models.Profile,
	settings models.AppSettings,
	domain string,
) []string {
	order := make([]string, 0, len(candidates))
	for _, profile := range candidates {
		order = append(order, profile.ID)
	}
	if len(order) < 2 {
		return order
	}

	type measured struct {
		result probe.ProfilePing
		icmp   bool
	}
	// Buffered for every result, so probes still running after the
	// deadline never block on a reader that has gone.
	results := make(chan measured, 2*len(candidates)+4)
	go probe.PingEach(candidates, settings, domain, func(result probe.ProfilePing) {
		results <- measured{result, true}
	})
	go probe.ConnectivityEach(candidates, settings, domain, order, probeTimeoutMS, func(result probe.ProfilePing) {
		results <- measured{result, false}
	})

	tcp := map[string]uint64{}
	icmp := map[string]uint64{}
	var icmpSeen, tcpSeen []probe.ProfilePing
	expected := 2 * len(candidates)
	deadline := time.NewTimer(rankBudget)
	defer deadline.Stop()
collect:
	for received := 0; received < expected; received++ {
		select {
		case item := <-results:
			if item.icmp {
				icmpSeen = append(icmpSeen, item.result)
			} else {
				tcpSeen = append(tcpSeen, item.result)
			}
			if item.result.PingMS == nil {
				continue
			}
			if item.icmp {
				icmp[item.result.ID] = *item.result.PingMS
			} else {
				tcp[item.result.ID] = *item.result.PingMS
			}
		case <-deadline.C:
			break collect
		}
	}
	a.recordPings(icmpSeen, true)
	a.recordPings(tcpSeen, false)

	rank := func(id string) (tier int, ms uint64) {
		if value, ok := tcp[id]; ok {
			return 0, value
		}
		if value, ok := icmp[id]; ok {
			return 1, value
		}
		return 2, 0
	}
	sort.SliceStable(order, func(i, j int) bool {
		leftTier, leftMS := rank(order[i])
		rightTier, rightMS := rank(order[j])
		if leftTier != rightTier {
			return leftTier < rightTier
		}
		return leftMS < rightMS
	})
	if len(tcp)+len(icmp) == 0 {
		a.appendLog("No server answered a probe in time; trying them in order")
	}
	return a.demoteFailing(order)
}

// startProfile generates a config for one profile and hands it to the core.
func (a *App) startProfile(
	profile models.Profile,
	profiles []models.Profile,
	settings models.AppSettings,
	alternatives []models.Profile,
) error {
	// Building the config reads whole geo databases and rule lists, tens of
	// megabytes that are garbage a moment later. Go returns freed memory to
	// the system only slowly, so without this the spike stays in the app's
	// footprint for minutes after every connect.
	defer releaseMemory()

	// Rule-sets from the user's own geoip.dat / geosite.dat, if any. What
	// they lack is reported, not fatal: the rest of the routing still works.
	localSets, customGeo, geoWarnings := geoRuleSets(settings)
	for _, warning := range geoWarnings {
		a.appendLog("WARN " + warning)
	}

	// Rule lists the core cannot read itself, converted; refreshed when
	// they are a day old.
	lists, listWarnings := a.prepareRuleLists(settings, false)
	for _, warning := range listWarnings {
		a.appendLog("WARN " + warning)
	}

	request := sbconfig.Request{
		Profile:       profile,
		Profiles:      profiles,
		Settings:      settings,
		MixedPort:     MixedPort,
		CacheFilePath: filepath.Join(storage.RuntimeDir(), "cache.db"),
		LocalRuleSets: localSets,
		CustomGeo:     customGeo,
		RuleLists:     lists,
		Alternatives:  alternatives,
	}

	// Another core than the built-in one: see cores.go.
	switch settings.Core {
	case models.CoreMihomo:
		return a.startMihomo(profile, profiles, settings, alternatives, lists)
	case models.CoreXray:
		return a.startXray(profile, profiles, settings, request)
	}

	result, err := sbconfig.Build(request)
	if err != nil {
		return err
	}
	for _, warning := range result.Warnings {
		a.appendLog("WARN " + warning)
	}
	a.mu.Lock()
	a.ruleOwners = result.RuleOwners
	a.serverFor = result.ServerFor
	a.ruleTexts = nil
	a.mu.Unlock()

	// Mirror the config to disk purely so users can inspect what ran.
	_ = os.WriteFile(storage.CoreConfigPath(), result.JSON, 0o600)

	a.appendLog(fmt.Sprintf("Starting %s (%s)", profile.Name, profile.Protocol))
	if result.Verbatim {
		a.appendLog("Using the profile's own sing-box config verbatim")
	} else {
		mode := "full tunnel"
		if settings.SplitTunnelling() {
			mode = fmt.Sprintf("split tunnel (default: %s, %d rule entries)",
				settings.DefaultAction, result.SplitRules)
		}
		a.appendLog("Routing mode: " + mode)
		if result.ChainHops > 0 {
			a.appendLog(fmt.Sprintf("Proxy chain: %d hop(s) before the exit", result.ChainHops))
		}
	}

	if settings.Core == models.CoreSingBox {
		// The same config, on official sing-box instead of the fork.
		a.appendLog("Running on official sing-box")
		return a.core.StartCore(core.StartRequest{Core: core.CoreSingBox, Config: result.JSON})
	}
	return a.core.Start(result.JSON)
}

// fastestCandidates bounds the servers the core keeps measuring. Each is
// probed every few minutes; a whole subscription would be a lot of probes for
// little gain over its best few.
const fastestCandidates = 8

// alternativesFor lists the servers the exit may switch between: in
// automatic mode with the setting on, the best-ranked servers of the plan.
func alternativesFor(plan connectionPlan, profiles []models.Profile, settings models.AppSettings, mode, connected string) []models.Profile {
	if !settings.FastestServer || mode != ModeAuto || len(plan.order) < 2 {
		return nil
	}
	result := []models.Profile{}
	for _, id := range plan.order {
		if len(result) == fastestCandidates {
			break
		}
		if profile, ok := profileByID(profiles, id); ok {
			result = append(result, profile)
		}
	}
	if len(result) < 2 {
		return nil
	}
	return result
}

func profileByID(profiles []models.Profile, id string) (models.Profile, bool) {
	for _, profile := range profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return models.Profile{}, false
}

package app

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/probe"
	"github.com/Rigby-Foundation/NuggetVPN/internal/speedtest"
	"github.com/Rigby-Foundation/NuggetVPN/internal/stats"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Statistics: traffic by program, server health, speed tests
// ---------------------------------------------------------------------------

// Events for the window.
const (
	speedProgressEventName = "speed-progress"
	wifiEventName          = "wifi-changed"
)

// insights holds what the background work keeps between rounds.
type insights struct {
	once  sync.Once
	store *stats.Store

	mu sync.Mutex
	// seen is each open connection's byte counts at the last look, so only
	// what was added since is counted.
	seen map[string][2]int64
	// speed cancels a running speed test; nil when none is running.
	speed context.CancelFunc
}

func (a *App) statsStore() *stats.Store {
	a.insights.once.Do(func() {
		a.insights.store = stats.Open(filepath.Join(storage.DataDir(), "stats.json"))
	})
	return a.insights.store
}

// runBackground is the app's clock: counting traffic by program, checking
// servers, following the routing schedule and the Wi-Fi rules, and saving
// statistics. It runs until the app stops.
func (a *App) runBackground(ctx context.Context) {
	usage := time.NewTicker(2 * time.Second)
	defer usage.Stop()
	schedule := time.NewTicker(20 * time.Second)
	defer schedule.Stop()
	network := time.NewTicker(10 * time.Second)
	defer network.Stop()
	save := time.NewTicker(time.Minute)
	defer save.Stop()
	// The first health round a little after start, then every quarter hour.
	health := time.NewTimer(90 * time.Second)
	defer health.Stop()

	a.followSchedule()
	a.checkWifi()
	for {
		select {
		case <-ctx.Done():
			_ = a.statsStore().Save()
			return
		case <-usage.C:
			a.countUsage()
		case <-schedule.C:
			a.followSchedule()
		case <-network.C:
			a.checkWifi()
		case <-save.C:
			_ = a.statsStore().Save()
		case <-health.C:
			a.checkServers()
			health.Reset(15 * time.Minute)
		}
	}
}

// countUsage adds what each program sent and received since the last look.
func (a *App) countUsage() {
	_, settings := a.snapshot()
	a.mu.Lock()
	connected := a.state.Status == StatusConnected
	a.mu.Unlock()
	if !connected || !models.On(settings.AppStats) {
		a.insights.mu.Lock()
		a.insights.seen = nil
		a.insights.mu.Unlock()
		return
	}
	open := a.GetConnections()
	now := time.Now()
	a.insights.mu.Lock()
	defer a.insights.mu.Unlock()
	next := make(map[string][2]int64, len(open))
	for _, connection := range open {
		previous := a.insights.seen[connection.ID]
		up, down := connection.Upload-previous[0], connection.Download-previous[1]
		if up < 0 || down < 0 {
			// A new connection that reused an id: count it from zero.
			up, down = connection.Upload, connection.Download
		}
		a.statsStore().AddUsage(now, connection.App, uint64(max(up, 0)), uint64(max(down, 0)))
		next[connection.ID] = [2]int64{connection.Upload, connection.Download}
	}
	a.insights.seen = next
}

// AppUsage is traffic by program over the last days, and day by day.
type AppUsage struct {
	Programs []stats.ProgramUsage `json:"programs"`
	Days     []stats.DayUsage     `json:"days"`
}

// GetAppUsage reports traffic by program over the last days (1 = today).
func (a *App) GetAppUsage(days int) AppUsage {
	programs, daily := a.statsStore().Usage(min(max(days, 1), 90), time.Now())
	return AppUsage{Programs: programs, Days: daily}
}

// ClearStatistics forgets traffic by program, server history and speed
// tests.
func (a *App) ClearStatistics() error {
	a.statsStore().Clear()
	return a.statsStore().Save()
}

// ---------------------------------------------------------------------------
// Server health
// ---------------------------------------------------------------------------

// recordPings adds probe results to the servers' history. A ping that got no
// answer is not held against a server: many filter ICMP and work fine.
func (a *App) recordPings(results []probe.ProfilePing, icmp bool) {
	_, settings := a.snapshot()
	if !models.On(settings.ServerHealth) {
		return
	}
	now := time.Now().Unix()
	for _, result := range results {
		sample := stats.Sample{At: now, Kind: stats.KindPing, MS: -1}
		if result.PingMS != nil {
			sample.MS = int(*result.PingMS)
		} else if icmp {
			continue
		}
		a.statsStore().Record(result.ID, sample)
	}
}

// recordEvent adds a connection attempt or drop to a server's history.
func (a *App) recordEvent(server, kind string, ok bool) {
	_, settings := a.snapshot()
	if !models.On(settings.ServerHealth) || server == "" {
		return
	}
	sample := stats.Sample{At: time.Now().Unix(), Kind: kind, MS: 0}
	if !ok {
		sample.MS = -1
	}
	a.statsStore().Record(server, sample)
}

// maxHealthChecks bounds a background round.
const maxHealthChecks = 60

// checkServers checks a round of servers in the background: the ones in the
// configuration in use first, then the favourites, then the rest, by TCP
// handshake, which gets through where ICMP does not.
func (a *App) checkServers() {
	profiles, settings := a.snapshot()
	if !models.On(settings.ServerHealth) || len(profiles) == 0 {
		return
	}
	current := ""
	if settings.LastSelection != nil {
		current = settings.LastSelection.Domain
	}
	ordered := append([]models.Profile(nil), profiles...)
	rank := func(profile models.Profile) int {
		switch {
		case profile.NormalizedSourceDomain() == current:
			return 0
		case profile.Favorite:
			return 1
		}
		return 2
	}
	sort.SliceStable(ordered, func(i, j int) bool { return rank(ordered[i]) < rank(ordered[j]) })
	if len(ordered) > maxHealthChecks {
		ordered = ordered[:maxHealthChecks]
	}
	bySource := map[string][]string{}
	for _, profile := range ordered {
		source := profile.NormalizedSourceDomain()
		bySource[source] = append(bySource[source], profile.ID)
	}
	for source, ids := range bySource {
		a.recordPings(probe.Connectivity(profiles, settings, source, ids, 2500), false)
	}
}

// GetServerHealth sums up each server's history, by profile id.
func (a *App) GetServerHealth() map[string]stats.Health {
	profiles, _ := a.snapshot()
	now := time.Now()
	result := make(map[string]stats.Health, len(profiles))
	for _, profile := range profiles {
		health := a.statsStore().HealthOf(profile.ID, now)
		if health.Checks > 0 {
			result[profile.ID] = health
		}
	}
	return result
}

// demoteFailing moves servers that keep failing to the back, keeping the
// order otherwise: in automatic mode they are tried last, not skipped.
func (a *App) demoteFailing(order []string) []string {
	_, settings := a.snapshot()
	if !models.On(settings.ServerHealth) {
		return order
	}
	now := time.Now()
	healthy := make([]string, 0, len(order))
	var failing []string
	for _, id := range order {
		if a.statsStore().Failing(id, now) {
			failing = append(failing, id)
		} else {
			healthy = append(healthy, id)
		}
	}
	if len(failing) > 0 && len(healthy) > 0 {
		a.appendLog("Trying servers that keep failing last")
	}
	return append(healthy, failing...)
}

// ---------------------------------------------------------------------------
// Speed test
// ---------------------------------------------------------------------------

// SpeedTestResult is a finished speed test, with the server it went
// through.
type SpeedTestResult = stats.SpeedResult

// RunSpeedTest measures the connection through the current server.
// Progress arrives as speed-progress events.
func (a *App) RunSpeedTest() (SpeedTestResult, error) {
	a.mu.Lock()
	state := a.state
	a.mu.Unlock()
	if state.Status != StatusConnected {
		return SpeedTestResult{}, errors.New("connect first: the test measures the connection through the server")
	}
	ctx, cancel := context.WithCancel(a.context())
	a.insights.mu.Lock()
	if a.insights.speed != nil {
		a.insights.mu.Unlock()
		cancel()
		return SpeedTestResult{}, errors.New("a speed test is already running")
	}
	a.insights.speed = cancel
	a.insights.mu.Unlock()
	defer func() {
		a.insights.mu.Lock()
		a.insights.speed = nil
		a.insights.mu.Unlock()
		cancel()
	}()

	a.appendLog("Speed test through " + state.Profile)
	result, err := speedtest.Run(ctx, func(progress speedtest.Progress) {
		a.emit(speedProgressEventName, progress)
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return SpeedTestResult{}, errors.New("stopped")
		}
		return SpeedTestResult{}, err
	}
	record := stats.SpeedResult{
		At: time.Now().Unix(), Server: state.Profile,
		Download: result.Download, Upload: result.Upload, Latency: result.Latency, Jitter: result.Jitter,
	}
	a.statsStore().AddSpeed(record)
	_ = a.statsStore().Save()
	return record, nil
}

// StopSpeedTest stops a running speed test.
func (a *App) StopSpeedTest() {
	a.insights.mu.Lock()
	defer a.insights.mu.Unlock()
	if a.insights.speed != nil {
		a.insights.speed()
	}
}

// GetSpeedTests lists recent speed tests, newest last.
func (a *App) GetSpeedTests() []SpeedTestResult {
	return a.statsStore().Speeds()
}

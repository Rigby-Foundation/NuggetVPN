package app

import (
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/stats"
	"github.com/Rigby-Foundation/NuggetVPN/internal/xrayconfig"
)

type analyticsState struct {
	// Clock and reset markers are guarded by App.mu, like connection state.
	at          time.Time
	lastSession int64
	epoch       uint64
	resetSince  int64

	// Keep polling and clearing serialized across the core request.
	sampleMu     sync.Mutex
	last         *core.TrafficReport
	sampledSince int64
	sampledEpoch uint64
}

func (a *App) advanceAnalyticsClockLocked(now time.Time) {
	history := &a.insights.analytics
	if a.state.Status == StatusConnected && models.On(a.settings.AppStats) && !history.at.IsZero() {
		a.statsStore().AddConnected(history.at, now)
	}
	history.at = now
}

func (a *App) recordAnalyticsStateLocked(next ConnectionState) {
	now := time.Now()
	a.advanceAnalyticsClockLocked(now)
	history := &a.insights.analytics
	if next.Status != StatusConnected || next.Since == 0 || history.lastSession == next.Since {
		return
	}
	history.lastSession = next.Since
	if models.On(a.settings.AppStats) {
		a.statsStore().AddSession(now)
	}
}

func (a *App) resetAnalyticsSampleLocked() {
	a.insights.analytics.epoch++
	a.insights.analytics.resetSince = a.state.Since
}

// countUsage samples cumulative Xray counters, including flows that opened
// and closed since the last poll. The core call must stay outside App.mu.
func (a *App) countUsage() {
	history := &a.insights.analytics
	history.sampleMu.Lock()
	defer history.sampleMu.Unlock()

	a.mu.Lock()
	active := a.state.Status == StatusConnected && models.On(a.settings.AppStats)
	since, epoch := a.state.Since, history.epoch
	a.advanceAnalyticsClockLocked(time.Now())
	a.mu.Unlock()
	if !active || a.core == nil {
		return
	}
	report, ok := a.core.TrafficReport()
	if !ok || report == nil {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.state.Status != StatusConnected || since != a.state.Since || epoch != history.epoch {
		return
	}
	previous := history.last
	if history.sampledSince != since || (previous != nil && previous.ID != report.ID) {
		previous = nil
	}
	reset := history.sampledEpoch != epoch && history.resetSince == since
	history.last, history.sampledSince, history.sampledEpoch = report, since, epoch
	if !reset {
		traffic, servers, programs := trafficDelta(report, previous, a.serverFor)
		a.statsStore().AddTraffic(time.Now(), traffic, servers, programs)
	}
}

func trafficDelta(report, previous *core.TrafficReport, serverFor map[string]string) (stats.Traffic, map[string]stats.Bytes, map[string]stats.Bytes) {
	if previous == nil {
		previous = &core.TrafficReport{}
	}
	traffic := stats.Traffic{Bytes: bytesDelta(report.Total, previous.Total)}
	servers, programs := map[string]stats.Bytes{}, map[string]stats.Bytes{}
	for route, total := range report.ByRoute {
		delta := bytesDelta(total, previous.ByRoute[route])
		if delta.Up == 0 && delta.Down == 0 {
			continue
		}
		if route == xrayconfig.DirectTag {
			traffic.Direct = delta
		} else if id := serverFor[route]; id != "" {
			traffic.Proxied = sumBytes(traffic.Proxied, delta)
			servers[id] = sumBytes(servers[id], delta)
		}
	}
	for program, total := range report.ByApp {
		delta := bytesDelta(total, previous.ByApp[program])
		if delta.Up != 0 || delta.Down != 0 {
			programs[program] = delta
		}
	}
	return traffic, servers, programs
}

func bytesDelta(total, previous core.TrafficBytes) stats.Bytes {
	delta := func(value, before uint64) uint64 {
		if value < before {
			return value
		}
		return value - before
	}
	return stats.Bytes{Up: delta(total.Up, previous.Up), Down: delta(total.Down, previous.Down)}
}

func sumBytes(left, right stats.Bytes) stats.Bytes {
	return stats.Bytes{Up: left.Up + right.Up, Down: left.Down + right.Down}
}

// GetTrafficAnalytics returns the recent daily timeline and its breakdowns.
func (a *App) GetTrafficAnalytics(days int) (stats.Analytics, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.profileStore.CheckAccess(); err != nil {
		return stats.Analytics{}, err
	}
	now := time.Now()
	a.advanceAnalyticsClockLocked(now)
	return a.statsStore().Analytics(days, now), nil
}

// ClearStatistics forgets traffic, server health history and speed tests.
func (a *App) ClearStatistics() error {
	history := &a.insights.analytics
	history.sampleMu.Lock()
	defer history.sampleMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	history.at = time.Now()
	a.resetAnalyticsSampleLocked()
	store := a.statsStore()
	store.Clear()
	return store.Save()
}

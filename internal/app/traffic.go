package app

import (
	"time"
	
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

type TrafficSample struct {
	Up        uint64 `json:"up"`
	Down      uint64 `json:"down"`
	UpRate    uint64 `json:"up_rate"`
	DownRate  uint64 `json:"down_rate"`
	TotalUp   uint64 `json:"total_up"`
	TotalDown uint64 `json:"total_down"`
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

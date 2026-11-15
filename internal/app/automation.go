package app

import (
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Routing schedule
// ---------------------------------------------------------------------------

type automation struct {
	mu sync.Mutex
	// scheduled is what the schedule last wanted, with the schedule it came
	// from: the schedule acts when either changes, so a setup the user picks
	// by hand stays until the next scheduled change.
	scheduled string
}

// followSchedule switches to the setup the routing schedule wants, when that
// changes.
func (a *App) followSchedule() {
	_, settings := a.snapshot()
	want := settings.ScheduledSetup(time.Now())
	key := fmt.Sprint(want, settings.RoutingSchedule, settings.ScheduleFallback)

	a.automation.mu.Lock()
	changed := key != a.automation.scheduled
	a.automation.scheduled = key
	a.automation.mu.Unlock()
	if !changed || want == "" || want == settings.ActiveRoutingSetup {
		return
	}
	name := want
	for _, setup := range settings.RoutingSetups {
		if setup.ID == want && setup.Name != "" {
			name = setup.Name
		}
	}
	a.appendLog("Routing schedule: switching to " + name)
	if _, err := a.SwitchRoutingSetup(want); err != nil {
		a.appendLog("WARN routing schedule: " + err.Error())
	}
}

package xrayruntime

import (
	"path"
	"strings"
	"sync/atomic"
)

// TrafficBytes are cumulative payload counters for the current Xray instance.
type TrafficBytes struct {
	Up   uint64 `json:"up"`
	Down uint64 `json:"down"`
}

type TrafficReport struct {
	ID      string                  `json:"id"`
	Total   TrafficBytes            `json:"total"`
	ByRoute map[string]TrafficBytes `json:"by_route"`
	ByApp   map[string]TrafficBytes `json:"by_app"`
}

type trafficCounter struct {
	up, down atomic.Int64
}

func usageCounter(index map[string]*trafficCounter, key string) *trafficCounter {
	counter := index[key]
	if counter == nil {
		counter = &trafficCounter{}
		index[key] = counter
	}
	return counter
}

// usageCounters is called with the tracker locked. Keep application names
// only, and cap their number so short-lived processes can't grow the report.
func (t *tracker) usageCounters(route, process string) (*trafficCounter, *trafficCounter) {
	app := path.Base(strings.ReplaceAll(process, `\`, "/"))
	if app == "." || (len(t.byApp) >= 512 && t.byApp[app] == nil) {
		app = ""
	}
	return usageCounter(t.byRoute, route), usageCounter(t.byApp, app)
}

// TrafficReport keeps completed as well as open connections in the totals.
func (i *Instance) TrafficReport() (*TrafficReport, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.tracker == nil {
		return nil, false
	}
	t := i.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	snapshot := &TrafficReport{
		ID: t.usageID, ByRoute: make(map[string]TrafficBytes, len(t.byRoute)),
		ByApp: make(map[string]TrafficBytes, len(t.byApp)),
	}
	for tag, counter := range t.byRoute {
		bytes := TrafficBytes{Up: uint64(counter.up.Load()), Down: uint64(counter.down.Load())}
		snapshot.ByRoute[tag] = bytes
		snapshot.Total.Up += bytes.Up
		snapshot.Total.Down += bytes.Down
	}
	for app, counter := range t.byApp {
		snapshot.ByApp[app] = TrafficBytes{Up: uint64(counter.up.Load()), Down: uint64(counter.down.Load())}
	}
	return snapshot, true
}

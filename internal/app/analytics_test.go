package app

import (
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/core"
)

func TestTrafficAnalyticsAttributesOnlyTheCounterDelta(t *testing.T) {
	current := &core.TrafficReport{
		Total: core.TrafficBytes{Up: 91, Down: 150},
		ByRoute: map[string]core.TrafficBytes{
			"direct": {Up: 22, Down: 30}, "exit": {Up: 44, Down: 80},
			"server-2": {Up: 15, Down: 40}, "block": {Up: 10},
		},
		ByApp: map[string]core.TrafficBytes{"Browser": {Up: 91, Down: 150}},
	}
	previous := &core.TrafficReport{
		Total:   core.TrafficBytes{Up: 30, Down: 60},
		ByRoute: map[string]core.TrafficBytes{"exit": {Up: 30, Down: 60}},
		ByApp:   map[string]core.TrafficBytes{"Browser": {Up: 30, Down: 60}},
	}
	traffic, servers, apps := trafficDelta(current, previous, map[string]string{"exit": "one", "server-2": "two"})
	if traffic.Up != 61 || traffic.Down != 90 || traffic.Direct.Down != 30 || traffic.Proxied.Down != 60 ||
		servers["one"].Down != 20 || servers["two"].Down != 40 || apps["Browser"] != traffic.Bytes {
		t.Fatalf("wrong accounting: total=%+v servers=%+v programs=%+v", traffic, servers, apps)
	}
}

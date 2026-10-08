package app

import (
	"errors"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func TestLocalFailureStopsTheServerHunt(t *testing.T) {
	cases := []struct {
		err    string
		reason string
	}{
		// The tester's Windows log, verbatim.
		{"start sing-box service: start inbound/tun[tun-in]: configure tun interface: The system cannot find the file specified.", ReasonAdapter},
		{"start inbound/mixed[mixed-in]: listen tcp 127.0.0.1:7890: bind: address already in use", ReasonLocal},
		{"start service: Access is denied.", ReasonLocal},
		// A server's own problem: the next server may well work.
		{"vless: parse outbound: missing uuid", ""},
		{"initialize outbound[proxy]: unknown transport", ""},
	}
	for _, c := range cases {
		reason, local := localFailure(errors.New(c.err))
		if reason != c.reason || local != (c.reason != "") {
			t.Errorf("%q: got (%q, %v), want %q", c.err, reason, local, c.reason)
		}
	}
}

func TestServerFallbackOff(t *testing.T) {
	off := false
	settings := models.AppSettings{ServerFallback: &off}
	profiles := []models.Profile{
		{ID: "a", Name: "A", SourceDomain: "sub.example", ConfigLink: "vless://00000000-0000-0000-0000-000000000000@a.example:443"},
		{ID: "b", Name: "B", SourceDomain: "sub.example", ConfigLink: "vless://00000000-0000-0000-0000-000000000000@b.example:443"},
	}
	app := &App{}
	plan, err := app.planConnection(profiles, settings, "sub.example", ModeManual, "b")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.order) != 1 || plan.order[0] != "b" || plan.resilient {
		t.Fatalf("manual with fallback off: got %+v, want only b", plan)
	}

	on := true
	settings.ServerFallback = &on
	plan, err = app.planConnection(profiles, settings, "sub.example", ModeManual, "b")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.order) != 2 || plan.order[0] != "b" || !plan.resilient {
		t.Fatalf("manual with fallback on: got %+v, want b then a", plan)
	}
}

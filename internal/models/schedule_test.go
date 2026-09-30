package models

import (
	"testing"
	"time"
)

func TestScheduledSetup(t *testing.T) {
	settings := DefaultSettings()
	settings.RoutingSetups = []RoutingSetup{{ID: DefaultSetupID}, {ID: "work", Name: "Work"}, {ID: "night", Name: "Night"}}
	settings.ActiveRoutingSetup = DefaultSetupID
	settings.RoutingSchedule = []ScheduleEntry{
		{Setup: "work", Days: []int{1, 2, 3, 4, 5}, Start: "09:00", End: "18:00"},
		{Setup: "night", Days: []int{5}, Start: "23:00", End: "02:00"},
		{Setup: "gone", Days: []int{0}, Start: "10:00", End: "11:00"},
		{Setup: "work", Days: []int{9}, Start: "10:00", End: "11:00"},
	}
	settings.ScheduleFallback = "main"
	settings.Normalize()
	if len(settings.RoutingSchedule) != 2 {
		t.Fatalf("entries naming no setup or no day should go: %+v", settings.RoutingSchedule)
	}

	at := func(day, clock string) time.Time {
		parsed, err := time.ParseInLocation("2006-01-02 15:04", day+" "+clock, time.Local)
		if err != nil {
			t.Fatal(err)
		}
		return parsed
	}
	// 2026-09-28 is a Monday; 2026-10-02 a Friday.
	cases := map[time.Time]string{
		at("2026-09-28", "09:00"): "work",
		at("2026-09-28", "17:59"): "work",
		at("2026-09-28", "18:00"): "main",
		at("2026-10-02", "23:30"): "night",
		at("2026-10-03", "01:59"): "night", // Saturday morning, after Friday night
		at("2026-10-03", "02:00"): "main",
		at("2026-10-04", "10:30"): "main", // Sunday
	}
	for when, want := range cases {
		if got := settings.ScheduledSetup(when); got != want {
			t.Errorf("%s: %q, want %q", when.Format("Mon 15:04"), got, want)
		}
	}

	settings.ScheduleFallback = ""
	if got := settings.ScheduledSetup(at("2026-10-04", "10:30")); got != "" {
		t.Errorf("no fallback should mean no opinion, got %q", got)
	}
}

package stats

import (
	"path/filepath"
	"testing"
	"time"
)

func TestUsageByProgramAndDay(t *testing.T) {
	store := Open(filepath.Join(t.TempDir(), "stats.json"))
	now := time.Now()
	store.AddUsage(now, "chrome.exe", 100, 1000)
	store.AddUsage(now, "chrome.exe", 50, 500)
	store.AddUsage(now.AddDate(0, 0, -1), "Telegram.exe", 10, 20)
	store.AddUsage(now.AddDate(0, 0, -10), "old.exe", 1, 1)

	programs, days := store.Usage(1, now)
	if len(programs) != 1 || programs[0].Program != "chrome.exe" || programs[0].Down != 1500 {
		t.Errorf("today: %+v", programs)
	}
	programs, days = store.Usage(7, now)
	if len(programs) != 2 || programs[0].Program != "chrome.exe" || len(days) != 7 || days[6].Down != 1500 || days[5].Down != 20 {
		t.Errorf("week: %+v %+v", programs, days)
	}

	// It survives a restart.
	if err := store.Save(); err != nil {
		t.Fatal(err)
	}
	again := Open(store.path)
	if programs, _ := again.Usage(30, now); len(programs) != 3 {
		t.Errorf("reloaded: %+v", programs)
	}
}

func TestAnalyticsPersistsDailyCountersAndSplitsTimeAtMidnight(t *testing.T) {
	store := Open(filepath.Join(t.TempDir(), "stats.json"))
	year, month, day := time.Now().Date()
	midnight := time.Date(year, month, day, 0, 0, 0, 0, time.Local)
	yesterday, now := midnight.Add(-time.Minute), midnight.Add(2*time.Minute)
	store.AddSession(yesterday)
	store.AddConnected(yesterday, now)
	store.AddTraffic(yesterday, Traffic{Bytes: Bytes{Up: 15, Down: 144}, Proxied: Bytes{Up: 15, Down: 144}}, map[string]Bytes{"server-id": {Up: 15, Down: 144}}, map[string]Bytes{"Browser": {Up: 15, Down: 144}})
	store.AddTraffic(now, Traffic{Bytes: Bytes{Up: 30, Down: 100}, Direct: Bytes{Up: 30, Down: 100}}, nil, map[string]Bytes{"Browser": {Up: 30, Down: 100}})
	if err := store.Save(); err != nil {
		t.Fatal(err)
	}
	reopened := Open(store.path)
	week := reopened.Analytics(7, now)
	before, after := week.Days[5], week.Days[6]
	if before.ConnectedMS != 60_000 || after.ConnectedMS != 120_000 || before.Sessions != 1 || after.Sessions != 0 {
		t.Fatalf("time or sessions assigned to the wrong day: %+v / %+v", before, after)
	}
	if before.Proxied.Down != 144 || after.Direct.Down != 100 || week.Servers["server-id"].Down != 144 {
		t.Fatalf("lost route or server usage: %+v", week)
	}
	if len(week.Programs) != 1 || week.Programs[0].Down != 244 || reopened.Analytics(1, now).Programs[0].Down != 100 {
		t.Fatalf("wrong program totals for range: %+v", week.Programs)
	}
	reopened.Clear()
	if err := reopened.Save(); err != nil {
		t.Fatal(err)
	}
	cleared := Open(store.path).Analytics(7, now)
	if len(cleared.Programs) != 0 || len(cleared.Servers) != 0 || cleared.Days[5].Sessions != 0 {
		t.Fatalf("cleared history survived restart: %+v", cleared)
	}
}

func TestHealth(t *testing.T) {
	store := Open(filepath.Join(t.TempDir(), "stats.json"))
	now := time.Now()
	at := func(ago time.Duration) int64 { return now.Add(-ago).Unix() }
	store.Record("a", Sample{At: at(3 * time.Hour), Kind: KindPing, MS: 40})
	store.Record("a", Sample{At: at(2 * time.Hour), Kind: KindPing, MS: 60})
	store.Record("a", Sample{At: at(1 * time.Hour), Kind: KindConnect, MS: -1})
	store.Record("a", Sample{At: at(30 * time.Minute), Kind: KindPing, MS: 50})

	health := store.HealthOf("a", now)
	if health.Uptime24h != 0.75 || health.Latency != 50 || health.Checks != 4 || health.Failing || len(health.Recent) != 4 {
		t.Errorf("health %+v", health)
	}

	// Three failures in a row, recently: failing.
	for i := 3; i > 0; i-- {
		store.Record("b", Sample{At: at(time.Duration(i) * time.Minute), Kind: KindConnect, MS: -1})
	}
	if !store.Failing("b", now) {
		t.Error("three recent failures should mark a server failing")
	}
	// A success since clears it.
	store.Record("b", Sample{At: at(0), Kind: KindPing, MS: 30})
	if store.Failing("b", now) {
		t.Error("a success should clear failing")
	}
	// Old failures do not count.
	for i := 3; i > 0; i-- {
		store.Record("c", Sample{At: at(20*time.Hour + time.Duration(i)*time.Minute), Kind: KindDrop, MS: 0})
	}
	if store.Failing("c", now) {
		t.Error("failures from yesterday should not mark a server failing now")
	}
	// Samples arriving out of order are kept in order.
	store.Record("d", Sample{At: at(time.Minute), Kind: KindPing, MS: 1})
	store.Record("d", Sample{At: at(time.Hour), Kind: KindPing, MS: 2})
	if recent := store.HealthOf("d", now).Recent; recent[0].MS != 2 {
		t.Errorf("out of order: %+v", recent)
	}
}

// Package stats keeps what the app learns over time: how much each program
// sent and received, how each server has behaved, and speed test results.
//
// Everything is held in memory and written to one JSON file now and then;
// losing the last minute of it in a crash costs nothing that matters.
package stats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// How long things are kept.
const (
	usageDays      = 90
	healthWindow   = 7 * 24 * time.Hour
	samplesPerHost = 600
	speedResults   = 30
)

// Bytes is traffic in both directions.
type Bytes struct {
	Up   uint64 `json:"up"`
	Down uint64 `json:"down"`
}

// Kinds of health sample.
const (
	// KindPing is a latency check.
	KindPing = "ping"
	// KindConnect is a connection attempt.
	KindConnect = "connect"
	// KindDrop is a tunnel that went down on its own.
	KindDrop = "drop"
)

// Sample is one observation of a server.
type Sample struct {
	// At is unix seconds.
	At   int64  `json:"at"`
	Kind string `json:"kind"`
	// MS is the latency, for a ping that answered; -1 for a failure.
	MS int `json:"ms"`
}

// OK reports whether the sample is a success.
func (s Sample) OK() bool { return s.MS >= 0 && s.Kind != KindDrop }

// SpeedResult is one speed test.
type SpeedResult struct {
	At       int64   `json:"at"`
	Server   string  `json:"server"`
	Download float64 `json:"download_mbps"`
	Upload   float64 `json:"upload_mbps"`
	Latency  float64 `json:"latency_ms"`
	Jitter   float64 `json:"jitter_ms"`
}

type file struct {
	// Usage is day ("2006-01-02") → program → bytes.
	Usage  map[string]map[string]*Bytes `json:"usage"`
	Health map[string][]Sample          `json:"health"`
	Speed  []SpeedResult                `json:"speed"`
}

// Store is the app's statistics.
type Store struct {
	path  string
	mu    sync.Mutex
	data  file
	dirty bool
}

// Open loads the statistics kept at path, or starts empty.
func Open(path string) *Store {
	store := &Store{path: path}
	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &store.data)
	}
	if store.data.Usage == nil {
		store.data.Usage = map[string]map[string]*Bytes{}
	}
	if store.data.Health == nil {
		store.data.Health = map[string][]Sample{}
	}
	return store
}

// Save writes the statistics if anything changed.
func (s *Store) Save() error {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return nil
	}
	s.prune(time.Now())
	data, err := json.Marshal(s.data)
	s.dirty = false
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.path)
}

// Clear forgets everything.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = file{Usage: map[string]map[string]*Bytes{}, Health: map[string][]Sample{}}
	s.dirty = true
}

func (s *Store) prune(now time.Time) {
	oldest := now.AddDate(0, 0, -usageDays).Format(time.DateOnly)
	for day := range s.data.Usage {
		if day < oldest {
			delete(s.data.Usage, day)
		}
	}
	cutoff := now.Add(-healthWindow).Unix()
	for id, samples := range s.data.Health {
		first := sort.Search(len(samples), func(i int) bool { return samples[i].At >= cutoff })
		samples = samples[first:]
		if len(samples) > samplesPerHost {
			samples = samples[len(samples)-samplesPerHost:]
		}
		if len(samples) == 0 {
			delete(s.data.Health, id)
		} else {
			s.data.Health[id] = samples
		}
	}
	if len(s.data.Speed) > speedResults {
		s.data.Speed = s.data.Speed[len(s.data.Speed)-speedResults:]
	}
}

// ---------------------------------------------------------------------------
// Traffic by program
// ---------------------------------------------------------------------------

// AddUsage counts traffic for a program on a day.
func (s *Store) AddUsage(day time.Time, program string, up, down uint64) {
	if up == 0 && down == 0 {
		return
	}
	key := day.Format(time.DateOnly)
	s.mu.Lock()
	defer s.mu.Unlock()
	programs := s.data.Usage[key]
	if programs == nil {
		programs = map[string]*Bytes{}
		s.data.Usage[key] = programs
	}
	counter := programs[program]
	if counter == nil {
		counter = &Bytes{}
		programs[program] = counter
	}
	counter.Up += up
	counter.Down += down
	s.dirty = true
}

// ProgramUsage is one program's traffic over a period.
type ProgramUsage struct {
	Program string `json:"program"`
	Up      uint64 `json:"up"`
	Down    uint64 `json:"down"`
}

// DayUsage is one day's traffic, all programs together.
type DayUsage struct {
	Day  string `json:"day"`
	Up   uint64 `json:"up"`
	Down uint64 `json:"down"`
}

// Usage is traffic over the last days (1 = today), by program, busiest
// first, and by day, oldest first with empty days included.
func (s *Store) Usage(days int, now time.Time) ([]ProgramUsage, []DayUsage) {
	if days < 1 {
		days = 1
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	totals := map[string]*ProgramUsage{}
	daily := make([]DayUsage, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		key := now.AddDate(0, 0, -offset).Format(time.DateOnly)
		day := DayUsage{Day: key}
		for program, counter := range s.data.Usage[key] {
			total := totals[program]
			if total == nil {
				total = &ProgramUsage{Program: program}
				totals[program] = total
			}
			total.Up += counter.Up
			total.Down += counter.Down
			day.Up += counter.Up
			day.Down += counter.Down
		}
		daily = append(daily, day)
	}
	programs := make([]ProgramUsage, 0, len(totals))
	for _, total := range totals {
		programs = append(programs, *total)
	}
	sort.Slice(programs, func(a, b int) bool {
		left, right := programs[a].Up+programs[a].Down, programs[b].Up+programs[b].Down
		if left != right {
			return left > right
		}
		return strings.ToLower(programs[a].Program) < strings.ToLower(programs[b].Program)
	})
	return programs, daily
}

// ---------------------------------------------------------------------------
// Server health
// ---------------------------------------------------------------------------

// Record adds an observation of a server.
func (s *Store) Record(server string, sample Sample) {
	if server == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	samples := s.data.Health[server]
	// Kept in time order, which Record's callers nearly always are.
	index := len(samples)
	for index > 0 && samples[index-1].At > sample.At {
		index--
	}
	samples = append(samples, Sample{})
	copy(samples[index+1:], samples[index:])
	samples[index] = sample
	if len(samples) > samplesPerHost {
		samples = samples[len(samples)-samplesPerHost:]
	}
	s.data.Health[server] = samples
	s.dirty = true
}

// Health is a server's record, summed up.
type Health struct {
	// Uptime is the share of checks that succeeded, 0–1, over a day and a
	// week; -1 when there were none.
	Uptime24h float64 `json:"uptime_24h"`
	Uptime7d  float64 `json:"uptime_7d"`
	// Latency is the median ping over a day, in ms; 0 when none answered.
	Latency int `json:"latency_ms"`
	// Checks counts the samples over the week.
	Checks int `json:"checks"`
	// Failing is set when the server keeps failing; see Failing.
	Failing bool `json:"failing"`
	// Recent are the last day's samples, oldest first, for a graph.
	Recent []Sample `json:"recent"`
}

// HealthOf sums up a server's record.
func (s *Store) HealthOf(server string, now time.Time) Health {
	s.mu.Lock()
	samples := append([]Sample(nil), s.data.Health[server]...)
	s.mu.Unlock()

	day := now.Add(-24 * time.Hour).Unix()
	week := now.Add(-healthWindow).Unix()
	health := Health{Uptime24h: -1, Uptime7d: -1, Recent: []Sample{}}
	var okDay, allDay, okWeek, allWeek int
	var latencies []int
	for _, sample := range samples {
		if sample.At < week {
			continue
		}
		allWeek++
		if sample.OK() {
			okWeek++
		}
		if sample.At >= day {
			allDay++
			if sample.OK() {
				okDay++
			}
			if sample.Kind == KindPing && sample.MS >= 0 {
				latencies = append(latencies, sample.MS)
			}
			health.Recent = append(health.Recent, sample)
		}
	}
	if allDay > 0 {
		health.Uptime24h = float64(okDay) / float64(allDay)
	}
	if allWeek > 0 {
		health.Uptime7d = float64(okWeek) / float64(allWeek)
	}
	if len(latencies) > 0 {
		sort.Ints(latencies)
		health.Latency = latencies[len(latencies)/2]
	}
	health.Checks = allWeek
	health.Failing = failing(samples, now)
	return health
}

// Failing reports whether a server has failed its last three checks, the
// latest within twelve hours: a server worth trying last, not first.
func (s *Store) Failing(server string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return failing(s.data.Health[server], now)
}

func failing(samples []Sample, now time.Time) bool {
	if len(samples) < 3 || samples[len(samples)-1].At < now.Add(-12*time.Hour).Unix() {
		return false
	}
	for _, sample := range samples[len(samples)-3:] {
		if sample.OK() {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Speed tests
// ---------------------------------------------------------------------------

// AddSpeed records a speed test.
func (s *Store) AddSpeed(result SpeedResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Speed = append(s.data.Speed, result)
	if len(s.data.Speed) > speedResults {
		s.data.Speed = s.data.Speed[len(s.data.Speed)-speedResults:]
	}
	s.dirty = true
}

// Speeds are the recent speed tests, newest last.
func (s *Store) Speeds() []SpeedResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SpeedResult{}, s.data.Speed...)
}

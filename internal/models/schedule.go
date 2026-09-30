package models

import (
	"fmt"
	"strings"
	"time"
)

// ScheduleEntry turns a routing setup on at set times of the week.
type ScheduleEntry struct {
	ID    string `json:"id"`
	Setup string `json:"setup"`
	// Days are weekdays, 0 for Sunday to 6 for Saturday.
	Days []int `json:"days"`
	// Start and End are "15:04", local time. An End before Start runs past
	// midnight, into the next day.
	Start string `json:"start"`
	End   string `json:"end"`
}

// maxScheduleEntries bounds the schedule.
const maxScheduleEntries = 50

func clockMinutes(value string) (int, bool) {
	parsed, err := time.Parse("15:04", strings.TrimSpace(value))
	if err != nil {
		return 0, false
	}
	return parsed.Hour()*60 + parsed.Minute(), true
}

// covers reports whether the entry is on at now.
func (e ScheduleEntry) covers(now time.Time) bool {
	start, ok := clockMinutes(e.Start)
	end, ok2 := clockMinutes(e.End)
	if !ok || !ok2 || start == end {
		return false
	}
	minute := now.Hour()*60 + now.Minute()
	today := int(now.Weekday())
	has := func(day int) bool {
		for _, candidate := range e.Days {
			if candidate == day {
				return true
			}
		}
		return false
	}
	if start < end {
		return has(today) && minute >= start && minute < end
	}
	// Past midnight: the evening of a listed day, or the small hours after it.
	yesterday := (today + 6) % 7
	return (has(today) && minute >= start) || (has(yesterday) && minute < end)
}

// ScheduledSetup is the setup the schedule wants on at now: the first entry
// that covers it, else ScheduleFallback. Empty means the schedule has no
// opinion, and whatever is on stays on.
func (s AppSettings) ScheduledSetup(now time.Time) string {
	for _, entry := range s.RoutingSchedule {
		if entry.covers(now) {
			return entry.Setup
		}
	}
	return s.ScheduleFallback
}

// normalizeSchedule drops entries that name no setup or cannot be read, so
// the schedule never switches to something that is not there.
func (s *AppSettings) normalizeSchedule() {
	exists := map[string]bool{}
	for _, setup := range s.RoutingSetups {
		exists[setup.ID] = true
	}
	kept := make([]ScheduleEntry, 0, len(s.RoutingSchedule))
	for index, entry := range s.RoutingSchedule {
		if len(kept) == maxScheduleEntries {
			break
		}
		_, startOK := clockMinutes(entry.Start)
		_, endOK := clockMinutes(entry.End)
		if !exists[entry.Setup] || !startOK || !endOK || entry.Start == entry.End {
			continue
		}
		seen := map[int]bool{}
		days := []int{}
		for _, day := range entry.Days {
			if day >= 0 && day <= 6 && !seen[day] {
				seen[day] = true
				days = append(days, day)
			}
		}
		if len(days) == 0 {
			continue
		}
		entry.Days = days
		if entry.ID == "" {
			entry.ID = fmt.Sprintf("schedule-%d", index+1)
		}
		kept = append(kept, entry)
	}
	s.RoutingSchedule = kept
	if s.ScheduleFallback != "" && !exists[s.ScheduleFallback] {
		s.ScheduleFallback = ""
	}
}

// normalizeNetworks tidies the trusted Wi-Fi networks.
func (s *AppSettings) normalizeNetworks() {
	seen := map[string]bool{}
	kept := []string{}
	for _, name := range s.TrustedNetworks {
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 64 || seen[name] || len(kept) == 100 {
			continue
		}
		seen[name] = true
		kept = append(kept, name)
	}
	s.TrustedNetworks = kept
}

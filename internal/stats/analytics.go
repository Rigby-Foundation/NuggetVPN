package stats

import "time"

type Traffic struct {
	Bytes
	Direct  Bytes `json:"direct"`
	Proxied Bytes `json:"proxied"`
}

type AnalyticsDay struct {
	Day string `json:"day"`
	Traffic
	ConnectedMS int64  `json:"connected_ms"`
	Sessions    uint64 `json:"sessions"`
}

type trafficDay struct {
	AnalyticsDay
	Servers map[string]Bytes `json:"servers,omitempty"`
}

type Analytics struct {
	Days     []AnalyticsDay   `json:"days"`
	Programs []ProgramUsage   `json:"programs"`
	Servers  map[string]Bytes `json:"servers"`
}

func (b *Bytes) add(other Bytes) {
	b.Up += other.Up
	b.Down += other.Down
}

func (s *Store) dayLocked(key string) *trafficDay {
	day := s.data.Traffic[key]
	if day == nil {
		day = &trafficDay{AnalyticsDay: AnalyticsDay{Day: key}, Servers: map[string]Bytes{}}
		s.data.Traffic[key] = day
	}
	s.dirty = true
	return day
}

func (s *Store) AddTraffic(at time.Time, traffic Traffic, servers, programs map[string]Bytes) {
	key := at.Format(time.DateOnly)
	s.mu.Lock()
	defer s.mu.Unlock()
	if traffic.Up != 0 || traffic.Down != 0 {
		day := s.dayLocked(key)
		day.Bytes.add(traffic.Bytes)
		day.Direct.add(traffic.Direct)
		day.Proxied.add(traffic.Proxied)
		if day.Servers == nil {
			day.Servers = map[string]Bytes{}
		}
		for id, bytes := range servers {
			sum := day.Servers[id]
			sum.add(bytes)
			day.Servers[id] = sum
		}
	}
	for app, bytes := range programs {
		s.addUsage(key, app, bytes)
	}
}

func (s *Store) AddSession(at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dayLocked(at.Format(time.DateOnly)).Sessions++
}

func (s *Store) AddConnected(from, to time.Time) {
	from = from.In(to.Location())
	if oldest := to.AddDate(0, 0, -usageDays); from.Before(oldest) {
		from = oldest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for from.Before(to) {
		year, month, day := from.Date()
		end := time.Date(year, month, day+1, 0, 0, 0, 0, to.Location())
		if !end.After(from) {
			// Some local zones skip midnight when clocks change.
			end = from.Truncate(time.Hour).Add(time.Hour)
		}
		if to.Before(end) {
			end = to
		}
		ms := end.Sub(from).Milliseconds()
		if ms > 0 {
			s.dayLocked(from.Format(time.DateOnly)).ConnectedMS += ms
		}
		from = end
	}
}

func (s *Store) Analytics(days int, now time.Time) Analytics {
	days = min(max(days, 1), usageDays)
	s.mu.Lock()
	defer s.mu.Unlock()
	programs, _ := s.usageLocked(days, now)
	result := Analytics{
		Days: make([]AnalyticsDay, 0, days), Programs: programs, Servers: map[string]Bytes{},
	}
	for offset := days - 1; offset >= 0; offset-- {
		key := now.AddDate(0, 0, -offset).Format(time.DateOnly)
		day := s.data.Traffic[key]
		if day == nil {
			result.Days = append(result.Days, AnalyticsDay{Day: key})
			continue
		}
		result.Days = append(result.Days, day.AnalyticsDay)
		for id, bytes := range day.Servers {
			sum := result.Servers[id]
			sum.add(bytes)
			result.Servers[id] = sum
		}
	}
	return result
}

// Package probe measures reachability of the servers behind saved profiles.
package probe

import (
	"context"
	"net"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

const (
	pingTimeout = 2 * time.Second
	workerLimit = 12
)

// ProfilePing is one measurement; PingMS is null when the probe failed.
type ProfilePing struct {
	ID     string  `json:"id"`
	PingMS *uint64 `json:"ping_ms"`
}

type target struct {
	id   string
	host string
	port int
}

// selectTargets resolves the profiles in scope into probe targets, recording a
// null result for any profile whose link cannot be parsed.
func selectTargets(
	profiles []models.Profile,
	settings models.AppSettings,
	sourceDomain string,
	ids []string,
) ([]target, []ProfilePing) {
	domain := sourceDomain
	if domain == "" {
		domain = "local"
	}

	var idFilter map[string]bool
	if len(ids) > 0 {
		idFilter = make(map[string]bool, len(ids))
		for _, id := range ids {
			idFilter[id] = true
		}
	}

	var targets []target
	var results []ProfilePing

	for _, profile := range profiles {
		if profile.NormalizedSourceDomain() != domain {
			continue
		}
		if idFilter != nil && !idFilter[profile.ID] {
			continue
		}

		outbound, err := link.ParseOutbound(profile.ConfigLink, settings)
		if err != nil || outbound.Server() == "" {
			results = append(results, ProfilePing{ID: profile.ID})
			continue
		}
		targets = append(targets, target{
			id:   profile.ID,
			host: outbound.Server(),
			port: outbound.ServerPort(),
		})
	}
	return targets, results
}

// run fans the measurement out over a bounded worker pool.
func run(targets []target, measure func(target) *uint64) []ProfilePing {
	if len(targets) == 0 {
		return nil
	}

	workers := workerLimit
	if len(targets) < workers {
		workers = len(targets)
	}

	queue := make(chan target)
	results := make([]ProfilePing, len(targets))
	indexes := make(map[string]int, len(targets))
	for index, item := range targets {
		indexes[item.id] = index
	}

	var mu sync.Mutex
	var group sync.WaitGroup
	group.Add(workers)

	for i := 0; i < workers; i++ {
		go func() {
			defer group.Done()
			for item := range queue {
				value := measure(item)
				mu.Lock()
				results[indexes[item.id]] = ProfilePing{ID: item.id, PingMS: value}
				mu.Unlock()
			}
		}()
	}
	for _, item := range targets {
		queue <- item
	}
	close(queue)
	group.Wait()

	return results
}

// Ping measures ICMP round trip time using the system ping utility.
func Ping(
	profiles []models.Profile,
	settings models.AppSettings,
	sourceDomain string,
) []ProfilePing {
	targets, results := selectTargets(profiles, settings, sourceDomain, nil)
	return append(results, run(targets, func(item target) *uint64 {
		return measureICMP(item.host, pingTimeout)
	})...)
}

// Connectivity measures how long a TCP handshake to the server takes, which
// works even where ICMP is filtered.
func Connectivity(
	profiles []models.Profile,
	settings models.AppSettings,
	sourceDomain string,
	ids []string,
	timeoutMS uint64,
) []ProfilePing {
	if timeoutMS == 0 {
		timeoutMS = 1200
	}
	if timeoutMS < 200 {
		timeoutMS = 200
	}
	if timeoutMS > 10_000 {
		timeoutMS = 10_000
	}
	timeout := time.Duration(timeoutMS) * time.Millisecond

	targets, results := selectTargets(profiles, settings, sourceDomain, ids)

	usable := targets[:0]
	for _, item := range targets {
		if item.port <= 0 {
			results = append(results, ProfilePing{ID: item.id})
			continue
		}
		usable = append(usable, item)
	}

	return append(results, run(usable, func(item target) *uint64 {
		return measureTCP(item.host, item.port, timeout)
	})...)
}

func measureICMP(host string, timeout time.Duration) *uint64 {
	address := resolveTarget(host)
	if address == "" {
		return nil
	}

	var args []string
	switch runtime.GOOS {
	case "windows":
		args = []string{"-n", "1", "-w", strconv.FormatInt(timeout.Milliseconds(), 10), address}
	case "darwin":
		// macOS expects -W in milliseconds.
		args = []string{"-c", "1", "-W", strconv.FormatInt(timeout.Milliseconds(), 10), address}
	default:
		seconds := int(timeout.Seconds())
		if seconds < 1 {
			seconds = 1
		}
		args = []string{"-c", "1", "-W", strconv.Itoa(seconds), address}
	}

	// The context guards against a ping binary that ignores its own timeout.
	ctx, cancel := context.WithTimeout(context.Background(), timeout+2*time.Second)
	defer cancel()

	start := time.Now()
	if err := exec.CommandContext(ctx, "ping", args...).Run(); err != nil {
		return nil
	}
	elapsed := uint64(time.Since(start).Milliseconds())
	return &elapsed
}

func measureTCP(host string, port int, timeout time.Duration) *uint64 {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), timeout)
	if err != nil {
		return nil
	}
	_ = conn.Close()
	elapsed := uint64(time.Since(start).Milliseconds())
	return &elapsed
}

// resolveTarget prefers an IPv4 address so the ping utility behaves the same
// way across platforms.
func resolveTarget(host string) string {
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	addresses, err := net.LookupIP(host)
	if err != nil || len(addresses) == 0 {
		return ""
	}
	for _, address := range addresses {
		if address.To4() != nil {
			return address.String()
		}
	}
	return addresses[0].String()
}

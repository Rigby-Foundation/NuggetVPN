package app

import (
	"github.com/Rigby-Foundation/NuggetVPN/internal/probe"
)

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

// PingProfiles measures ICMP latency for one subscription's profiles.
func (a *App) PingProfiles(sourceDomain string) []probe.ProfilePing {
	profiles, settings := a.snapshot()
	results := probe.Ping(profiles, settings, sourceDomain)
	if results == nil {
		return []probe.ProfilePing{}
	}
	a.recordPings(results, true)
	return results
}

// ProbeProfilesConnectivity measures TCP handshake latency, which works where
// ICMP is filtered.
func (a *App) ProbeProfilesConnectivity(
	sourceDomain string,
	profileIDs []string,
	timeoutMS uint64,
) []probe.ProfilePing {
	profiles, settings := a.snapshot()
	results := probe.Connectivity(profiles, settings, sourceDomain, profileIDs, timeoutMS)
	if results == nil {
		return []probe.ProfilePing{}
	}
	a.recordPings(results, false)
	return results
}

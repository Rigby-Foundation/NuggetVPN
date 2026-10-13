package app

import (
	"context"
	"net"
	"sync"
	"time"
)

// resolveTimeout bounds the whole lookup before a connect: a server whose
// name has not resolved by then is left to the core, as before.
const resolveTimeout = 3 * time.Second

// lastResolved keeps the last addresses found for each server name, for when
// a lookup fails: during a reconnect the network may be between states, and
// the address a server had a minute ago is a better bet than none.
var lastResolved sync.Map // domain -> []string

// resolveServers looks the servers' hostnames up with the system's resolver,
// before the tunnel exists, so the core does not have to: its own lookup goes
// to the configured DNS server directly over UDP, which ISPs that block or
// intercept public resolvers never answer. See sbconfig.Request.Resolve.
func (a *App) resolveServers(domains []string) map[string][]string {
	ctx, cancel := context.WithTimeout(context.Background(), resolveTimeout)
	defer cancel()

	var (
		mu     sync.Mutex
		wait   sync.WaitGroup
		result = make(map[string][]string, len(domains))
	)
	for _, domain := range domains {
		wait.Add(1)
		go func(domain string) {
			defer wait.Done()
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", domain)
			addresses := make([]string, 0, len(ips))
			for _, ip := range ips {
				addresses = append(addresses, ip.String())
			}
			if err != nil || len(addresses) == 0 {
				if cached, ok := lastResolved.Load(domain); ok {
					addresses = cached.([]string)
				}
			} else {
				lastResolved.Store(domain, addresses)
			}
			if len(addresses) == 0 {
				return
			}
			mu.Lock()
			result[domain] = addresses
			mu.Unlock()
		}(domain)
	}
	wait.Wait()
	return result
}

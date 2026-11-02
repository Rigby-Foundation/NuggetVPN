package app

import (
	"fmt"
	"net"
	"runtime"
	"strconv"
)

// localProxyPort is the port of the HTTP/SOCKS proxy the core offers on
// loopback beside the tunnel, or 0 for none.
//
// Not on a phone: there every installed app can reach loopback, and an open
// proxy there lets any of them go out through the server, past the per-app
// rules, and learn its address — which apps that look for VPNs do, by
// scanning loopback for such ports.
//
// On a desktop, only when the port is free. It is Clash's usual port, and
// with another client already on it the core would refuse to start at all,
// for a proxy nothing in the app depends on.
func (a *App) localProxyPort() int {
	if runtime.GOOS == "android" || runtime.GOOS == "ios" {
		return 0
	}
	// While the core runs it may be holding the port itself; keep what it
	// was given.
	if a.core.Running() {
		return int(a.proxyPort.Load())
	}
	port := 0
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(MixedPort)))
	if err == nil {
		listener.Close()
		port = MixedPort
	} else {
		a.appendLog(fmt.Sprintf("Port %d is taken by another program; the local proxy is off this time", MixedPort))
	}
	a.proxyPort.Store(int32(port))
	return port
}

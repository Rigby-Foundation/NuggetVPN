package models

import (
	"net"
	"net/url"
	"strconv"
	"strings"
)

// DNSServer is a parsed resolver address.
type DNSServer struct {
	// Type is a resolver transport routed through the Xray tunnel.
	Type   string
	Server string
	Port   int
	// Path is the DNS-over-HTTPS path.
	Path string
}

// defaultDNSPorts are the well-known ports, used when an address has none.
var defaultDNSPorts = map[string]int{
	"udp": 53, "tcp": 53, "https": 443,
}

// ParseDNSServer reads the resolver addresses the UI accepts:
//
//	1.1.1.1  or  1.1.1.1:53          plain DNS
//	udp:// tcp://                    with an address and optional port
//	https://dns.google/dns-query      DNS over HTTPS
func ParseDNSServer(value string) (DNSServer, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return DNSServer{}, false
	}
	if !strings.Contains(value, "://") {
		value = "udp://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return DNSServer{}, false
	}
	scheme := strings.ToLower(parsed.Scheme)
	port, known := defaultDNSPorts[scheme]
	if !known {
		return DNSServer{}, false
	}
	if raw := parsed.Port(); raw != "" {
		number, err := strconv.Atoi(raw)
		if err != nil || number < 1 || number > 65535 {
			return DNSServer{}, false
		}
		port = number
	}

	host := parsed.Hostname()
	if net.ParseIP(host) == nil && !validHostname(host) {
		return DNSServer{}, false
	}

	server := DNSServer{Type: scheme, Server: host, Port: port}
	if scheme == "https" {
		server.Path = parsed.EscapedPath()
		if server.Path == "" || server.Path == "/" {
			server.Path = "/dns-query"
		}
	} else if parsed.Path != "" && parsed.Path != "/" {
		return DNSServer{}, false
	}
	return server, true
}

// validHostname accepts letters, digits, hyphens and dots, with at least one
// dot: a resolver named by a bare word is almost certainly a typo.
func validHostname(host string) bool {
	if len(host) > 253 || !strings.Contains(host, ".") {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 {
			return false
		}
		for _, char := range label {
			switch {
			case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z',
				char >= '0' && char <= '9', char == '-':
			default:
				return false
			}
		}
	}
	return true
}

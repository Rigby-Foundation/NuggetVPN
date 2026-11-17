// Package core owns the embedded Xray instance and the small privileged
// service that hosts it.
//
// Xray is linked into this binary as a library. Creating a TUN interface
// still needs root, so the GUI re-executes *itself* with --core-service under an
// elevation prompt and then drives that process over a unix socket. There is no
// second program and no external core executable: the same code, the same
// version, one privilege boundary.
//
// # Authentication
//
// The socket hands a native Xray config to a root process, so being
// able to connect to it is equivalent to root. File permissions alone are not
// enough: chmod/chown are no-ops on AF_UNIX on Windows. Every connection must
// therefore open with a CmdHello carrying a per-session token that the GUI
// generates and drops in a 0600 file for the service to read. The token travels
// through a file rather than argv because argv is world-readable on Linux.
package core

import (
	"encoding/json"
	"github.com/Rigby-Foundation/Kage/internal/xrayruntime"
	"net"
	"strconv"
	"strings"
)

// Command names accepted by the core service.
const (
	// CmdHello authenticates a connection. It must be the first command sent;
	// anything else on an unauthenticated connection closes it.
	CmdHello         = "hello"
	CmdPing          = "ping"
	CmdStart         = "start"
	CmdStop          = "stop"
	CmdStatus        = "status"
	CmdStats         = "stats"
	CmdTrafficReport = "traffic_report"
	CmdShutdown      = "shutdown"
	// CmdRuleHits asks how many open connections each route rule matched.
	CmdRuleHits = "rule_hits"
	// CmdConnections lists the open connections.
	CmdConnections = "connections"
	// CmdCloseConnection closes one connection, or all with an empty ID.
	CmdCloseConnection = "close_connection"
)

// Event names pushed from the core service to the GUI.
const (
	EventLog   = "log"
	EventState = "state"
	// EventStats carries cumulative byte counters, pushed once a second while
	// the tunnel is up so the GUI never has to poll.
	EventStats = "stats"
)

// Request is one command from the GUI to the core service.
type Request struct {
	ID     uint64          `json:"id"`
	Cmd    string          `json:"cmd"`
	Config json.RawMessage `json:"config,omitempty"`
	// Token authenticates a CmdHello and is ignored on every other command.
	Token string `json:"token,omitempty"`
	// ConnectionID names the connection CmdCloseConnection closes.
	ConnectionID string `json:"connection_id,omitempty"`
	// Script is generated routing code, stored privately for this run.
	Script    string `json:"script,omitempty"`
	RuleCount int    `json:"rule_count,omitempty"`
}

// Response answers exactly one Request.
type Response struct {
	ID      uint64 `json:"id"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Running bool   `json:"running,omitempty"`
	Version string `json:"version,omitempty"`
	Up      int64  `json:"up,omitempty"`
	Down    int64  `json:"down,omitempty"`
	// Hits answers CmdRuleHits; see Instance.RuleHits.
	Hits []int `json:"hits,omitempty"`
	// Connections answers CmdConnections.
	Connections []ConnectionInfo `json:"connections,omitempty"`
	Traffic     *TrafficReport   `json:"traffic,omitempty"`
}

// ConnectionInfo is an in-process Xray connection snapshot.
type ConnectionInfo = xrayruntime.ConnectionInfo
type TrafficReport = xrayruntime.TrafficReport
type TrafficBytes = xrayruntime.TrafficBytes

// Event is an unsolicited message from the core service.
type Event struct {
	Event   string `json:"event"`
	Level   string `json:"level,omitempty"`
	Message string `json:"message,omitempty"`
	Running bool   `json:"running,omitempty"`
	Up      int64  `json:"up,omitempty"`
	Down    int64  `json:"down,omitempty"`
}

// Responses and events share one connection, which keeps ordering between
// "start succeeded" and the log lines that follow it.

// isTCP reports whether addr is a TCP address rather than a filesystem socket path.
func isTCP(addr string) bool {
	if strings.ContainsAny(addr, `/\`) {
		return false
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	p, err := strconv.Atoi(port)
	return err == nil && p >= 0 && p <= 65535
}

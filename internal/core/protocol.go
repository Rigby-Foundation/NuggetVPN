// Package core owns the embedded sing-box instance and the small privileged
// service that hosts it.
//
// sing-box is linked into this binary as a library. Creating a TUN interface
// still needs root, so the GUI re-executes *itself* with --core-service under an
// elevation prompt and then drives that process over a unix socket. There is no
// second program and no `sing-box run -c file.json`: the same code, the same
// version, one privilege boundary.
//
// # Authentication
//
// The socket hands an arbitrary sing-box config to a root process, so being
// able to connect to it is equivalent to root. File permissions alone are not
// enough: chmod/chown are no-ops on AF_UNIX on Windows. Every connection must
// therefore open with a CmdHello carrying a per-session token that the GUI
// generates and drops in a 0600 file for the service to read. The token travels
// through a file rather than argv because argv is world-readable on Linux.
package core

import "encoding/json"

// Command names accepted by the core service.
const (
	// CmdHello authenticates a connection. It must be the first command sent;
	// anything else on an unauthenticated connection closes it.
	CmdHello    = "hello"
	CmdPing     = "ping"
	CmdStart    = "start"
	CmdStop     = "stop"
	CmdStatus   = "status"
	CmdStats    = "stats"
	CmdShutdown = "shutdown"
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
}

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

// Package core owns the embedded sing-box instance and the small privileged
// service that hosts it.
//
// sing-box is linked into this binary as a library. Creating a TUN interface
// still needs root, so the GUI re-executes *itself* with --core-service under an
// elevation prompt and then drives that process over a unix socket. There is no
// second program and no `sing-box run -c file.json`: the same code, the same
// version, one privilege boundary.
package core

import "encoding/json"

// Command names accepted by the core service.
const (
	CmdPing     = "ping"
	CmdStart    = "start"
	CmdStop     = "stop"
	CmdStatus   = "status"
	CmdShutdown = "shutdown"
)

// Event names pushed from the core service to the GUI.
const (
	EventLog   = "log"
	EventState = "state"
)

// Request is one command from the GUI to the core service.
type Request struct {
	ID     uint64          `json:"id"`
	Cmd    string          `json:"cmd"`
	Config json.RawMessage `json:"config,omitempty"`
}

// Response answers exactly one Request.
type Response struct {
	ID      uint64 `json:"id"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Running bool   `json:"running,omitempty"`
	Version string `json:"version,omitempty"`
}

// Event is an unsolicited message from the core service.
type Event struct {
	Event   string `json:"event"`
	Level   string `json:"level,omitempty"`
	Message string `json:"message,omitempty"`
	Running bool   `json:"running,omitempty"`
}

// Responses and events share one connection, which keeps ordering between
// "start succeeded" and the log lines that follow it.

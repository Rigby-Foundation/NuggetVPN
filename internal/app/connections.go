package app

import (
	"path/filepath"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
)

// ---------------------------------------------------------------------------
// Live connections
// ---------------------------------------------------------------------------

// LiveConnection is one open connection, described for the connections
// screen in the app's own terms: the routing rule that caught it, and the
// server it went through.
type LiveConnection struct {
	ID       string `json:"id"`
	Network  string `json:"network"`
	Protocol string `json:"protocol,omitempty"`
	// Host is the site's name when the core knows it, else empty.
	Host        string `json:"host,omitempty"`
	Destination string `json:"destination"`
	// App is the program's file name; AppPath its full path.
	App     string `json:"app,omitempty"`
	AppPath string `json:"app_path,omitempty"`
	// Rule is the routing rule that matched, by id: DefaultRuleHits for
	// "everything else", "" for the connections the app routes itself (the
	// local network, the proxy's own address).
	Rule string `json:"rule"`
	// RuleText is an external core's own description of the matched rule,
	// when it cannot be traced back to a routing rule.
	RuleText string `json:"rule_text,omitempty"`
	// Route is "proxy" or "direct".
	Route string `json:"route"`
	// Server is the profile the connection goes through, for proxied ones.
	Server   string `json:"server,omitempty"`
	Upload   int64  `json:"upload"`
	Download int64  `json:"download"`
	Started  int64  `json:"started"`
}

// GetConnections lists the open connections. Empty while disconnected.
func (a *App) GetConnections() []LiveConnection {
	result := []LiveConnection{}

	a.mu.Lock()
	connected := a.state.Status == StatusConnected
	owners := a.ruleOwners
	servers := a.serverFor
	texts := a.ruleTexts
	a.mu.Unlock()
	if !connected {
		return result
	}

	open, ok := a.core.Connections()
	if !ok {
		return result
	}
	for _, connection := range open {
		live := LiveConnection{
			ID:          connection.ID,
			Network:     connection.Network,
			Protocol:    connection.Protocol,
			Host:        connection.Host,
			Destination: connection.Destination,
			Upload:      connection.Upload,
			Download:    connection.Download,
			Started:     connection.Started,
			Route:       "proxy",
		}
		if connection.Process != "" {
			live.AppPath = connection.Process
			// The path is from the core's machine, which is this one, but
			// Windows paths still need their own separator handled.
			live.App = filepath.Base(strings.ReplaceAll(connection.Process, `\`, "/"))
		}
		switch {
		case connection.RuleText != "":
			// An external core names the rule rather than numbering it.
			if owner, ok := ruleForText(texts, connection.RuleText); ok {
				live.Rule = owner
			} else {
				live.RuleText = connection.RuleText
			}
		case connection.Rule < 0:
			live.Rule = DefaultRuleHits
		case connection.Rule < len(owners):
			live.Rule = owners[connection.Rule]
		}
		if strings.EqualFold(connection.Outbound, sbconfig.DirectTag) {
			live.Route = "direct"
		} else {
			live.Server = servers[connection.Outbound]
		}
		result = append(result, live)
	}
	return result
}

// CloseConnection closes one open connection; the program that opened it
// sees it drop and usually connects again, through the current routing.
func (a *App) CloseConnection(id string) error {
	if strings.TrimSpace(id) == "" {
		return nil
	}
	return a.core.CloseConnection(id)
}

// CloseAllConnections closes every open connection.
func (a *App) CloseAllConnections() error {
	return a.core.CloseConnection("")
}

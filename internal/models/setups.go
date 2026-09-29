package models

import "strings"

// RoutingGraph is one complete routing setup: what the canvas shows.
type RoutingGraph struct {
	Rules         []RoutingRule    `json:"rules"`
	DefaultAction string           `json:"default_action"`
	DefaultServer string           `json:"default_server,omitempty"`
	Layout        map[string]Point `json:"layout"`
	Comments      []RoutingComment `json:"comments"`
	Servers       []string         `json:"servers,omitempty"`
}

// RoutingSetup is a saved, named routing graph.
type RoutingSetup struct {
	ID string `json:"id"`
	// Name is what the user called it. The first setup starts unnamed, and
	// the UI shows it under a translated default name.
	Name  string       `json:"name"`
	Graph RoutingGraph `json:"graph"`
}

// DefaultSetupID names the setup every install starts with.
const DefaultSetupID = "main"

// maxSetupName bounds a setup's name, in characters.
const maxSetupName = 60

// Graph returns the routing being edited.
func (s AppSettings) Graph() RoutingGraph {
	return RoutingGraph{
		Rules:         s.RoutingRules,
		DefaultAction: s.DefaultAction,
		DefaultServer: s.DefaultServer,
		Layout:        s.RoutingLayout,
		Comments:      s.RoutingComments,
		Servers:       s.RoutingServers,
	}
}

// SetGraph makes graph the routing being edited. Call Normalize afterwards.
func (s *AppSettings) SetGraph(graph RoutingGraph) {
	s.RoutingRules = graph.Rules
	if s.RoutingRules == nil {
		// Nil means "never had a graph" and would trigger the legacy
		// migration; a loaded graph always has one, even if empty.
		s.RoutingRules = []RoutingRule{}
	}
	s.DefaultAction = graph.DefaultAction
	if s.DefaultAction == "" {
		s.DefaultAction = ActionProxy
	}
	s.DefaultServer = graph.DefaultServer
	s.RoutingLayout = graph.Layout
	s.RoutingComments = graph.Comments
	s.RoutingServers = graph.Servers
}

// SwitchSetup stores the routing being edited into the active setup and
// loads the one named id. It reports false, changing nothing, when there is
// no such setup.
func (s *AppSettings) SwitchSetup(id string) bool {
	target := -1
	for index, setup := range s.RoutingSetups {
		if setup.ID == id {
			target = index
		}
	}
	if target < 0 {
		return false
	}
	for index := range s.RoutingSetups {
		if s.RoutingSetups[index].ID == s.ActiveRoutingSetup {
			s.RoutingSetups[index].Graph = s.Graph()
		}
	}
	s.SetGraph(s.RoutingSetups[target].Graph)
	s.ActiveRoutingSetup = id
	s.Normalize()
	return true
}

// normalizeSetups makes sure there is always at least one setup and that the
// active one exists.
func (s *AppSettings) normalizeSetups() {
	setups := make([]RoutingSetup, 0, len(s.RoutingSetups))
	seen := map[string]bool{}
	for _, setup := range s.RoutingSetups {
		setup.ID = strings.TrimSpace(setup.ID)
		if setup.ID == "" || seen[setup.ID] {
			continue
		}
		seen[setup.ID] = true
		setup.Name = strings.TrimSpace(setup.Name)
		if runes := []rune(setup.Name); len(runes) > maxSetupName {
			setup.Name = string(runes[:maxSetupName])
		}
		if setup.Graph.Rules == nil {
			setup.Graph.Rules = []RoutingRule{}
		}
		if setup.Graph.Layout == nil {
			setup.Graph.Layout = map[string]Point{}
		}
		if setup.Graph.Comments == nil {
			setup.Graph.Comments = []RoutingComment{}
		}
		if !ValidAction(setup.Graph.DefaultAction) {
			setup.Graph.DefaultAction = ActionProxy
		}
		setups = append(setups, setup)
	}
	if len(setups) == 0 {
		// Whatever routing there already is becomes the first setup.
		setups = append(setups, RoutingSetup{ID: DefaultSetupID, Graph: s.Graph()})
	}
	s.RoutingSetups = setups
	if !seen[s.ActiveRoutingSetup] {
		s.ActiveRoutingSetup = setups[0].ID
	}
	// The active entry mirrors the live graph, so a reader of the list (the
	// tray, an export) never sees a stale copy of it.
	for index := range s.RoutingSetups {
		if s.RoutingSetups[index].ID == s.ActiveRoutingSetup {
			s.RoutingSetups[index].Graph = s.Graph()
		}
	}
}

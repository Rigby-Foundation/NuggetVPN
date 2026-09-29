// Package vflow is the .vflow file: a routing setup that can be saved,
// shared, and loaded back.
//
// It is JSON, so it can be read and diffed, and it carries its own format
// name and version so a file from a newer build is refused with a reason
// rather than half-understood:
//
//	{
//	  "format": "nuggetvpn.vflow",
//	  "version": 1,
//	  "default_action": "proxy",
//	  "rules":    [ { "id", "kind", "values", "action" } ],
//	  "comments": [ { "id", "text" } ],
//	  "layout":   { "<node id>": { "x", "y" } },
//	  "geo":      { "geosite": { "url": "https://…/geosite.dat" } }
//	}
//
// Custom geo files are not embedded — a geosite.dat is tens of megabytes. A
// file that was downloaded is carried as its URL, so whoever loads the flow
// can fetch the same one; a file picked from disk cannot travel, and is left
// out.
package vflow

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Format names the file type inside the file itself.
const Format = "nuggetvpn.vflow"

// Version is the newest version this build writes and reads.
//
// Version 2 added combined rules, inverted rules, TCP/UDP and rule-list
// sources, the "drop" destination, per-rule servers and per-rule DNS. A flow
// that uses none of them is still written as version 1, so older builds can
// keep reading it; one that does is refused by them rather than loaded with
// those parts silently ignored.
const Version = 2

// Extension is the file extension, with its dot.
const Extension = ".vflow"

// GeoRef points at a geo file by where it can be downloaded.
type GeoRef struct {
	URL string `json:"url"`
}

// Flow is the file's content.
type Flow struct {
	Format        string                  `json:"format"`
	Version       int                     `json:"version"`
	DefaultAction string                  `json:"default_action"`
	// DefaultServer and Servers name servers by their id on the machine the
	// flow was made on. Elsewhere those ids mean nothing, and the traffic
	// goes through the connected server until the destination is re-pointed.
	DefaultServer string                  `json:"default_server,omitempty"`
	Servers       []string                `json:"servers,omitempty"`
	Rules         []models.RoutingRule    `json:"rules"`
	Comments      []models.RoutingComment `json:"comments"`
	Layout        map[string]models.Point `json:"layout"`
	Geo           map[string]GeoRef       `json:"geo,omitempty"`
}

// ErrNotFlow means the file is not a .vflow at all.
var ErrNotFlow = errors.New("not a .vflow file")

// Encode writes the routing part of settings as a flow.
func Encode(settings models.AppSettings) ([]byte, error) {
	flow := Flow{
		Format:        Format,
		Version:       requiredVersion(settings),
		DefaultAction: settings.DefaultAction,
		DefaultServer: settings.DefaultServer,
		Servers:       settings.RoutingServers,
		Rules:         settings.RoutingRules,
		Comments:      settings.RoutingComments,
		Layout:        settings.RoutingLayout,
	}
	for kind, file := range settings.GeoFiles {
		if file.Source == "url" && file.URL != "" {
			if flow.Geo == nil {
				flow.Geo = map[string]GeoRef{}
			}
			flow.Geo[kind] = GeoRef{URL: file.URL}
		}
	}
	if flow.Rules == nil {
		flow.Rules = []models.RoutingRule{}
	}
	if flow.Comments == nil {
		flow.Comments = []models.RoutingComment{}
	}
	if flow.Layout == nil {
		flow.Layout = map[string]models.Point{}
	}
	return json.MarshalIndent(flow, "", "  ")
}

// requiredVersion is the oldest version that can hold the routing.
func requiredVersion(settings models.AppSettings) int {
	if settings.DefaultAction == models.ActionDrop || settings.DefaultServer != "" || len(settings.RoutingServers) > 0 {
		return 2
	}
	for _, rule := range settings.RoutingRules {
		switch {
		case rule.Kind == models.SourceLogical, rule.Kind == models.SourceNetwork, rule.Kind == models.SourceRuleSet,
			rule.Action == models.ActionDrop, rule.Invert, rule.Server != "", rule.DNS != "":
			return 2
		}
	}
	return 1
}

// Decode reads a flow, refusing other files and newer versions by name.
func Decode(data []byte) (Flow, error) {
	var flow Flow
	if err := json.Unmarshal(data, &flow); err != nil {
		return Flow{}, fmt.Errorf("%w: %v", ErrNotFlow, err)
	}
	if flow.Format != Format {
		return Flow{}, ErrNotFlow
	}
	if flow.Version < 1 {
		return Flow{}, fmt.Errorf("%w: missing version", ErrNotFlow)
	}
	if flow.Version > Version {
		return Flow{}, fmt.Errorf("this .vflow is version %d, made by a newer NuggetVPN; this one reads up to version %d", flow.Version, Version)
	}
	return flow, nil
}

// Apply replaces the routing in settings with the flow's. Everything goes
// through the same normalisation as settings saved from the UI, so a
// hand-edited file cannot introduce a rule the app would not have allowed.
func Apply(settings models.AppSettings, flow Flow) models.AppSettings {
	settings.RoutingRules = flow.Rules
	if settings.RoutingRules == nil {
		settings.RoutingRules = []models.RoutingRule{}
	}
	settings.DefaultAction = flow.DefaultAction
	settings.DefaultServer = flow.DefaultServer
	settings.RoutingServers = flow.Servers
	settings.RoutingComments = flow.Comments
	settings.RoutingLayout = flow.Layout
	settings.Normalize()
	return settings
}

// MissingGeo lists the geo files a flow refers to that settings do not
// already use from the same address — the ones worth offering to download.
func MissingGeo(settings models.AppSettings, flow Flow) map[string]string {
	missing := map[string]string{}
	for kind, ref := range flow.Geo {
		url := strings.TrimSpace(ref.URL)
		if url == "" {
			continue
		}
		if current, ok := settings.GeoFiles[kind]; ok && current.URL == url {
			continue
		}
		missing[kind] = url
	}
	return missing
}

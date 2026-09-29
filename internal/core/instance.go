package core

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/gofrs/uuid/v5"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/common/trafficcontrol"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/log"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"
)

// LogSink receives every line sing-box emits.
type LogSink func(level, message string)

// platformWriter adapts LogSink to sing-box's log.PlatformWriter.
type platformWriter struct {
	sink LogSink
}

func (w platformWriter) DisableColors() bool { return true }

func (w platformWriter) WriteMessage(level log.Level, message string) {
	if w.sink != nil {
		w.sink(log.FormatLevel(level), message)
	}
}

// Instance owns at most one running sing-box.
type Instance struct {
	mu       sync.Mutex
	instance *box.Box
	cancel   context.CancelFunc
	// traffic is sing-box's own byte counter, taken from the service registry
	// box.New populates. It exists whenever the Clash API is wanted, which is
	// unconditional here because we always pass a PlatformLogWriter — see Stats.
	traffic *trafficcontrol.Manager
}

// Running reports whether a sing-box instance is currently up.
func (i *Instance) Running() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.instance != nil
}

// Stats returns sing-box's cumulative byte counters for the running instance.
//
// The counters come from the traffic manager sing-box builds whenever a
// PlatformLogWriter or a clash_api block is present — see box.New. Reading it
// in-process is deliberate: the alternative, an `external_controller` HTTP
// listener, would expose an unauthenticated control plane for this root process
// to every local program and, thanks to permissive CORS, to every web page the
// user visits.
func (i *Instance) Stats() (up, down int64, ok bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.instance == nil || i.traffic == nil {
		return 0, 0, false
	}
	up, down = i.traffic.Total()
	return up, down, true
}

// RuleHits counts the open connections by the route rule that matched them:
// one slot per rule in config order, then a last slot for connections no
// rule matched.
func (i *Instance) RuleHits() ([]int, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.instance == nil || i.traffic == nil {
		return nil, false
	}
	rules := i.instance.Router().Rules()
	index := make(map[adapter.Rule]int, len(rules))
	for position, rule := range rules {
		index[rule] = position
	}
	hits := make([]int, len(rules)+1)
	for _, connection := range i.traffic.Connections() {
		if connection.Rule == nil {
			hits[len(rules)]++
			continue
		}
		if position, ok := index[connection.Rule]; ok {
			hits[position]++
		}
	}
	return hits, true
}

// Connections lists the open connections, newest last.
func (i *Instance) Connections() ([]ConnectionInfo, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.instance == nil || i.traffic == nil {
		return nil, false
	}
	rules := i.instance.Router().Rules()
	index := make(map[adapter.Rule]int, len(rules))
	for position, rule := range rules {
		index[rule] = position
	}

	open := i.traffic.Connections()
	result := make([]ConnectionInfo, 0, len(open))
	for _, connection := range open {
		metadata := connection.Metadata
		info := ConnectionInfo{
			ID:          connection.ID.String(),
			Network:     metadata.Network,
			Protocol:    metadata.Protocol,
			Host:        metadata.Domain,
			Destination: metadata.Destination.String(),
			Rule:        -1,
			Outbound:    connection.Outbound,
			Upload:      connection.Upload.Load(),
			Download:    connection.Download.Load(),
			Started:     connection.CreatedAt.UnixMilli(),
		}
		if info.Host == "" && metadata.Destination.IsFqdn() {
			info.Host = metadata.Destination.Fqdn
		}
		if owner := metadata.ProcessInfo; owner != nil && len(owner.ProcessPaths) > 0 {
			info.Process = owner.ProcessPaths[0]
		}
		if connection.Rule != nil {
			if position, ok := index[connection.Rule]; ok {
				info.Rule = position
			}
		}
		result = append(result, info)
	}
	sort.Slice(result, func(a, b int) bool { return result[a].Started < result[b].Started })
	return result, true
}

// CloseConnection closes one open connection by id, or all of them when id
// is empty. A connection that has already closed is not an error.
func (i *Instance) CloseConnection(id string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.instance == nil || i.traffic == nil {
		return nil
	}
	if id == "" {
		i.traffic.CloseAllConnections()
		return nil
	}
	parsed, err := uuid.FromString(id)
	if err != nil {
		return fmt.Errorf("not a connection id: %q", id)
	}
	if tracker := i.traffic.Connection(parsed); tracker != nil {
		return tracker.Close()
	}
	return nil
}

// Start parses the config, builds a sing-box instance and starts it. Any
// previously running instance is stopped first so the caller can switch
// profiles without a separate stop round trip.
func (i *Instance) Start(configJSON []byte, sink LogSink) error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if err := i.stopLocked(); err != nil {
		return fmt.Errorf("stop previous instance: %w", err)
	}

	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, configJSON)
	if err != nil {
		return fmt.Errorf("invalid sing-box config: %w", err)
	}

	ctx, cancel := context.WithCancel(ctx)
	instance, err := box.New(box.Options{
		Context:           ctx,
		Options:           options,
		PlatformLogWriter: platformWriter{sink: sink},
	})
	if err != nil {
		cancel()
		return fmt.Errorf("create sing-box service: %w", err)
	}

	if err := instance.Start(); err != nil {
		_ = instance.Close()
		cancel()
		return fmt.Errorf("start sing-box service: %w", err)
	}

	i.instance = instance
	i.cancel = cancel
	// box.New registers the traffic manager on the context it was handed. A nil
	// here would just mean Stats reports nothing; buildtags.go already makes a
	// build without with_clash_api a compile error, and box.New itself fails
	// without it once a PlatformLogWriter is supplied.
	i.traffic = service.PtrFromContext[trafficcontrol.Manager](ctx)
	return nil
}

// Stop shuts the running instance down. Stopping when nothing runs is a no-op.
func (i *Instance) Stop() error {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.stopLocked()
}

func (i *Instance) stopLocked() error {
	if i.instance == nil {
		return nil
	}
	instance, cancel := i.instance, i.cancel
	i.instance, i.cancel = nil, nil
	i.traffic = nil

	// Cancelling first unblocks in-flight dials so Close returns promptly.
	if cancel != nil {
		cancel()
	}
	return instance.Close()
}

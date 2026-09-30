package core

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"sync"
	"time"

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

	// external is a whole external core (official sing-box, mihomo) running
	// in place of the built-in one.
	external *externalProcess
	// engine is Xray running beside the built-in core, which reaches the
	// servers through it.
	engine *externalProcess
}

// Running reports whether a core is currently up.
func (i *Instance) Running() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.instance != nil || i.external.alive()
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
	if i.external.alive() {
		return i.external.externalStats()
	}
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
	if i.external.alive() {
		return i.external.externalConnections()
	}
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
	if i.external.alive() {
		return i.external.closeConnection(id)
	}
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
	return i.startBuiltinLocked(configJSON, sink)
}

// StartCore starts whichever core the request names. onExit is called when an
// external core stops without being asked to — the tunnel is then down.
func (i *Instance) StartCore(request StartRequest, sink LogSink, onExit func(error)) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if err := i.stopLocked(); err != nil {
		return fmt.Errorf("stop previous instance: %w", err)
	}

	switch request.Core {
	case "", CoreBuiltin:
		return i.startBuiltinLocked(request.Config, sink)

	case CoreXray:
		// Xray first: the built-in core's proxy outbounds point at it.
		var engine *externalProcess
		engine, err := launchCore(CoreXray, map[string][]byte{"config.json": request.Aux},
			func(dir string) []string { return []string{"run", "-c", filepath.Join(dir, "config.json")} },
			nil, sink, func(err error) {
				// Without Xray the tunnel carries nothing; take it down —
				// unless another start has replaced it meanwhile.
				i.mu.Lock()
				current := i.engine == engine && engine != nil
				if current {
					_ = i.stopLocked()
				}
				i.mu.Unlock()
				if current {
					onExit(err)
				}
			})
		if err != nil {
			return err
		}
		if err := engine.waitReady(4 * time.Second); err != nil {
			engine.stop()
			return err
		}
		i.engine = engine
		if err := i.startBuiltinLocked(request.Config, sink); err != nil {
			engine.stop()
			i.engine = nil
			return err
		}
		return nil

	case CoreSingBox, CoreMihomo:
		var files map[string][]byte
		var args func(string) []string
		if request.Core == CoreSingBox {
			files = map[string][]byte{"config.json": request.Config}
			args = func(dir string) []string {
				return []string{"run", "-c", filepath.Join(dir, "config.json"), "-D", dir}
			}
		} else {
			files = map[string][]byte{"config.yaml": request.Config}
			args = func(dir string) []string { return []string{"-d", dir, "-f", filepath.Join(dir, "config.yaml")} }
		}
		var external *externalProcess
		external, err := launchCore(request.Core, files, args, request.Controller, sink, func(err error) {
			i.mu.Lock()
			current := i.external == external && external != nil
			if current {
				i.external = nil
			}
			i.mu.Unlock()
			if current {
				onExit(err)
			}
		})
		if err != nil {
			return err
		}
		if err := external.waitReady(10 * time.Second); err != nil {
			external.stop()
			return err
		}
		i.external = external
		return nil
	}
	return fmt.Errorf("unknown core %q", request.Core)
}

// startBuiltinLocked starts the embedded sing-box. Call with mu held and
// nothing running.
func (i *Instance) startBuiltinLocked(configJSON []byte, sink LogSink) error {

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
	if i.external != nil {
		i.external.stop()
		i.external = nil
	}
	defer func() {
		if i.engine != nil {
			i.engine.stop()
			i.engine = nil
		}
	}()
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

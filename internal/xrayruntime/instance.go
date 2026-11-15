// Package xrayruntime owns a native Xray instance and its in-process traffic
// tracking. It has no HTTP controller and no dependency on another core.
package xrayruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/xtls/xray-core/common"
	"github.com/xtls/xray-core/common/buf"
	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/session"
	xcore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/features/outbound"
	"github.com/xtls/xray-core/features/routing"
	rsession "github.com/xtls/xray-core/features/routing/session"
	"github.com/xtls/xray-core/transport"
)

type LogSink func(level, message string)

type ConnectionInfo struct {
	ID          string `json:"id"`
	Network     string `json:"network"`
	Protocol    string `json:"protocol,omitempty"`
	Host        string `json:"host,omitempty"`
	Destination string `json:"destination"`
	Process     string `json:"process,omitempty"`
	Rule        int    `json:"rule"`
	Outbound    string `json:"outbound"`
	Upload      int64  `json:"upload"`
	Download    int64  `json:"download"`
	Started     int64  `json:"started"`
}

type connection struct {
	info     ConnectionInfo
	up, down atomic.Int64
	close    func()
}
type tracker struct {
	mu       sync.Mutex
	open     map[string]*connection
	up, down atomic.Int64
	rules    int
	router   routing.Router
}

type Instance struct {
	mu        sync.Mutex
	instance  *xcore.Instance
	tracker   *tracker
	scriptDir string
}

func (i *Instance) Running() bool { i.mu.Lock(); defer i.mu.Unlock(); return i.instance != nil }

// StartConfig stops the previous instance and starts Xray from native JSON.
// Generated routing code is written to a private, short-lived file because
// Xray's Lua router accepts file paths, not inline programs.
func (i *Instance) StartConfig(config []byte, script string, ruleCount int, sink LogSink) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if err := i.stopLocked(); err != nil {
		return err
	}
	if script != "" {
		var root map[string]any
		if err := json.Unmarshal(config, &root); err != nil {
			return err
		}
		dir, err := os.MkdirTemp("", "kage-routing-")
		if err != nil {
			return err
		}
		i.scriptDir = dir
		path := filepath.Join(dir, "routing.lua")
		if err = os.WriteFile(path, []byte(script), 0o600); err != nil {
			i.clearScript()
			return err
		}
		routing, _ := root["routing"].(map[string]any)
		if routing == nil {
			routing = map[string]any{}
		}
		delete(routing, "rules")
		delete(routing, "domainStrategy")
		routing["script"] = path
		root["routing"] = routing
		config, err = json.Marshal(root)
		if err != nil {
			i.clearScript()
			return err
		}
	}
	instance, err := startXray(config, sink)
	if err != nil {
		i.clearScript()
		return err
	}
	t := &tracker{open: map[string]*connection{}, rules: ruleCount}
	if r := instance.GetFeature(routing.RouterType()); r != nil {
		t.router = r.(routing.Router)
	}
	manager := instance.GetFeature(outbound.ManagerType()).(outbound.Manager)
	handlers := manager.ListHandlers(context.Background())
	first := manager.GetDefaultHandler()
	// Keep the original default first. RemoveHandler only detaches it; the
	// wrapper owns its lifecycle from this point onward.
	sort.SliceStable(handlers, func(a, b int) bool { return handlers[a] == first && handlers[b] != first })
	for _, handler := range handlers {
		if err = manager.RemoveHandler(context.Background(), handler.Tag()); err != nil {
			_ = instance.Close()
			i.clearScript()
			return err
		}
	}
	for _, handler := range handlers {
		if err = manager.AddHandler(context.Background(), &trackedHandler{Handler: handler, tracker: t}); err != nil {
			_ = instance.Close()
			i.clearScript()
			return err
		}
	}
	if err = instance.Start(); err != nil {
		_ = instance.Close()
		i.clearScript()
		return fmt.Errorf("start Xray: %w", err)
	}
	i.instance, i.tracker = instance, t
	return nil
}

func (i *Instance) Stats() (int64, int64, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.tracker == nil {
		return 0, 0, false
	}
	return i.tracker.up.Load(), i.tracker.down.Load(), true
}
func (i *Instance) Connections() ([]ConnectionInfo, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.tracker == nil {
		return nil, false
	}
	t := i.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	result := make([]ConnectionInfo, 0, len(t.open))
	for _, c := range t.open {
		info := c.info
		info.Upload, info.Download = c.up.Load(), c.down.Load()
		result = append(result, info)
	}
	sort.Slice(result, func(a, b int) bool { return result[a].Started < result[b].Started })
	return result, true
}
func (i *Instance) RuleHits() ([]int, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.tracker == nil {
		return nil, false
	}
	t := i.tracker
	t.mu.Lock()
	defer t.mu.Unlock()
	hits := make([]int, t.rules)
	for _, c := range t.open {
		if c.info.Rule >= 0 && c.info.Rule < len(hits) {
			hits[c.info.Rule]++
		}
	}
	return hits, true
}
func (i *Instance) CloseConnection(id string) error {
	i.mu.Lock()
	t := i.tracker
	i.mu.Unlock()
	if t == nil {
		return nil
	}
	if id != "" {
		if _, err := uuid.Parse(id); err != nil {
			return fmt.Errorf("not a connection id: %q", id)
		}
	}
	t.mu.Lock()
	var closeFns []func()
	for key, c := range t.open {
		if id == "" || id == key {
			closeFns = append(closeFns, c.close)
		}
	}
	t.mu.Unlock()
	for _, closeFn := range closeFns {
		closeFn()
	}
	return nil
}
func (i *Instance) Stop() error { i.mu.Lock(); defer i.mu.Unlock(); return i.stopLocked() }
func (i *Instance) clearScript() {
	if i.scriptDir != "" {
		_ = os.RemoveAll(i.scriptDir)
		i.scriptDir = ""
	}
}
func (i *Instance) stopLocked() error {
	defer i.clearScript()
	if i.instance == nil {
		return nil
	}
	instance, t := i.instance, i.tracker
	i.instance, i.tracker = nil, nil
	t.mu.Lock()
	var closes []func()
	for _, c := range t.open {
		closes = append(closes, c.close)
	}
	t.mu.Unlock()
	for _, closeFn := range closes {
		closeFn()
	}
	return instance.Close()
}

type trackedHandler struct {
	outbound.Handler
	tracker *tracker
}

func (h *trackedHandler) Start() error { return h.Handler.Start() }
func (h *trackedHandler) Dispatch(ctx context.Context, link *transport.Link) {
	inbound := session.InboundFromContext(ctx)
	// Chained outbounds and DNS queries are internal, not additional user
	// connections. Only the original dispatch is counted.
	if inbound == nil || strings.HasPrefix(inbound.Tag, "dns") || ctx.Value(trackingKey{}) != nil {
		h.Handler.Dispatch(ctx, link)
		return
	}
	ctx = context.WithValue(ctx, trackingKey{}, true)
	info := ConnectionInfo{ID: uuid.NewString(), Rule: -1, Outbound: h.Tag(), Started: time.Now().UnixMilli()}
	outbounds := session.OutboundsFromContext(ctx)
	if len(outbounds) > 0 {
		target := outbounds[len(outbounds)-1].Target
		info.Destination = target.NetAddr()
		info.Network = strings.ToLower(target.Network.String())
		if target.Address.Family().IsDomain() {
			info.Host = target.Address.Domain()
		}
	}
	if content := session.ContentFromContext(ctx); content != nil {
		info.Protocol = content.Protocol
	}
	routingContext := rsession.AsRoutingContext(ctx)
	if sources := routingContext.GetSourceIPs(); len(sources) > 0 {
		targetIP := ""
		if targets := routingContext.GetTargetIPs(); len(targets) > 0 {
			targetIP = targets[0].String()
		}
		_, name, path, err := xnet.FindProcess(info.Network, sources[0].String(), uint16(routingContext.GetSourcePort()), targetIP, uint16(routingContext.GetTargetPort()))
		if err == nil {
			info.Process = path
			if info.Process == "" {
				info.Process = name
			}
		}
	}
	if h.tracker.router != nil {
		if route, err := h.tracker.router.PickRoute(routingContext); err == nil {
			if rule, err := strconv.Atoi(route.GetRuleTag()); err == nil {
				info.Rule = rule
			}
		}
	}
	c := &connection{info: info}
	ctx, cancel := context.WithCancel(ctx)
	var once sync.Once
	c.close = func() { once.Do(func() { cancel(); common.Interrupt(link.Reader); common.Interrupt(link.Writer) }) }
	h.tracker.mu.Lock()
	h.tracker.open[info.ID] = c
	h.tracker.mu.Unlock()
	defer func() { c.close(); h.tracker.mu.Lock(); delete(h.tracker.open, info.ID); h.tracker.mu.Unlock() }()
	counted := &transport.Link{Reader: &countedReader{Reader: link.Reader, local: &c.up, total: &h.tracker.up}, Writer: &countedWriter{Writer: link.Writer, local: &c.down, total: &h.tracker.down}}
	h.Handler.Dispatch(ctx, counted)
}

type trackingKey struct{}
type countedReader struct {
	buf.Reader
	local, total *atomic.Int64
}

func (r *countedReader) ReadMultiBuffer() (buf.MultiBuffer, error) {
	data, err := r.Reader.ReadMultiBuffer()
	size := int64(data.Len())
	r.local.Add(size)
	r.total.Add(size)
	return data, err
}
func (r *countedReader) Interrupt() { common.Interrupt(r.Reader) }

type countedWriter struct {
	buf.Writer
	local, total *atomic.Int64
}

func (w *countedWriter) WriteMultiBuffer(data buf.MultiBuffer) error {
	size := int64(data.Len())
	err := w.Writer.WriteMultiBuffer(data)
	if err == nil {
		w.local.Add(size)
		w.total.Add(size)
	}
	return err
}
func (w *countedWriter) Close() error { return common.Close(w.Writer) }
func (w *countedWriter) Interrupt()   { common.Interrupt(w.Writer) }

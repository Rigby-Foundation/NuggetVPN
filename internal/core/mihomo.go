package core

import (
	"fmt"
	"io"
	"net"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/metacubex/mihomo/common/observable"
	"github.com/metacubex/mihomo/config"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	mlog "github.com/metacubex/mihomo/log"
	"github.com/metacubex/mihomo/tunnel/statistic"
	"github.com/sirupsen/logrus"
)

// mihomoIdle is what mihomo is left on once stopped: no listeners, no TUN,
// no DNS and no servers.
const mihomoIdle = "mode: direct\nlog-level: silent\ntun:\n  enable: false\ndns:\n  enable: false\n"

// mihomoMu serialises mihomo's starts and stops: it is one set of globals.
var mihomoMu sync.Mutex

// mihomoCore is mihomo, running in this process. It keeps its state in
// package globals, so there is only ever one.
type mihomoCore struct {
	logs observable.Subscription[mlog.Event]
	done chan struct{}
}

func startMihomo(configYAML []byte, sink LogSink) (*mihomoCore, error) {
	mihomoMu.Lock()
	defer mihomoMu.Unlock()

	dir, err := runDir(CoreMihomo)
	if err != nil {
		return nil, err
	}
	C.SetHomeDir(dir)
	C.SetConfig(filepath.Join(dir, "config.yaml"))
	// mihomo's own printing goes to the service's output, which nobody
	// reads; lines reach the app through the subscription below.
	logrus.SetOutput(io.Discard)

	core := &mihomoCore{logs: mlog.Subscribe(), done: make(chan struct{})}
	go func() {
		defer close(core.done)
		for event := range core.logs {
			if sink != nil {
				sink(event.LogLevel.String(), event.Payload)
			}
		}
	}()
	// Never an API: the service reads everything in-process.
	if err := hub.Parse(configYAML, withoutController); err != nil {
		core.stopLogs()
		mihomoToIdle()
		return nil, fmt.Errorf("mihomo: %w", err)
	}
	return core, nil
}

// mihomoToIdle takes down everything a config set up.
func mihomoToIdle() {
	_ = hub.Parse([]byte(mihomoIdle))
	executor.Shutdown()
}

func (m *mihomoCore) stopLogs() {
	mlog.UnSubscribe(m.logs)
	<-m.done
}

func (m *mihomoCore) stats() (int64, int64) {
	return statistic.DefaultManager.Total()
}

func (m *mihomoCore) ruleHits() ([]int, bool) { return nil, false }

func (m *mihomoCore) connections() []ConnectionInfo {
	var result []ConnectionInfo
	statistic.DefaultManager.Range(func(tracker statistic.Tracker) bool {
		connection := tracker.Info()
		metadata := connection.Metadata
		info := ConnectionInfo{
			ID:       connection.UUID.String(),
			Network:  strings.ToLower(metadata.NetWork.String()),
			Host:     firstNonEmpty(metadata.Host, metadata.SniffHost),
			Process:  firstNonEmpty(metadata.ProcessPath, metadata.Process),
			Rule:     -1,
			Upload:   connection.UploadTotal.Load(),
			Download: connection.DownloadTotal.Load(),
			Started:  connection.Start.UnixMilli(),
		}
		if metadata.DstIP.IsValid() {
			info.Destination = net.JoinHostPort(metadata.DstIP.String(), strconv.Itoa(int(metadata.DstPort)))
		} else if metadata.Host != "" {
			info.Destination = net.JoinHostPort(metadata.Host, strconv.Itoa(int(metadata.DstPort)))
		}
		if connection.Rule != "" {
			info.RuleText = connection.Rule
			if connection.RulePayload != "" {
				info.RuleText += "," + connection.RulePayload
			}
		}
		// The first chain entry is the proxy the connection actually left
		// through; the rest are the groups that chose it.
		if len(connection.Chain) > 0 {
			info.Outbound = connection.Chain[0]
		}
		result = append(result, info)
		return true
	})
	sort.Slice(result, func(a, b int) bool { return result[a].Started < result[b].Started })
	return result
}

func (m *mihomoCore) closeConnection(id string) error {
	if id == "" {
		statistic.DefaultManager.Range(func(tracker statistic.Tracker) bool {
			_ = tracker.Close()
			return true
		})
		return nil
	}
	if tracker := statistic.DefaultManager.Get(id); tracker != nil {
		return tracker.Close()
	}
	return nil
}

func (m *mihomoCore) close() error {
	mihomoMu.Lock()
	defer mihomoMu.Unlock()
	mihomoToIdle()
	_ = m.closeConnection("")
	m.stopLogs()
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// withoutController drops any API a profile's own config asks for: this
// process is privileged, and the service reads everything in-process.
func withoutController(cfg *config.Config) {
	cfg.Controller = &config.Controller{}
}

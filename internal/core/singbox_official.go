package core

import (
	"context"
	"fmt"
	"sort"

	"github.com/gofrs/uuid/v5"
	sbjson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"

	box "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/common/trafficcontrol"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/include"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
)

func init() {
	C.Version = officialSingBoxVersion
}

// officialWriter adapts LogSink to official sing-box's log.PlatformWriter.
type officialWriter struct {
	sink LogSink
}

func (w officialWriter) WriteMessage(level log.Level, message string) {
	if w.sink != nil {
		w.sink(log.FormatLevel(level), message)
	}
}

// officialSingBox is official sing-box, a copy of it under a renamed module
// path so it links beside the fork. It takes the same config as the built-in
// core and tracks connections the same way, so everything reads alike.
type officialSingBox struct {
	instance *box.Box
	cancel   context.CancelFunc
	traffic  *trafficcontrol.Manager
}

func startOfficialSingBox(configJSON []byte, sink LogSink) (*officialSingBox, error) {
	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, configJSON)
	if err != nil {
		return nil, fmt.Errorf("invalid sing-box config: %w", err)
	}
	ctx, cancel := context.WithCancel(ctx)
	instance, err := box.New(box.Options{
		Context:           ctx,
		Options:           options,
		PlatformLogWriter: officialWriter{sink: sink},
	})
	if err != nil {
		cancel()
		return nil, fmt.Errorf("create sing-box service: %w", err)
	}
	if err := instance.Start(); err != nil {
		_ = instance.Close()
		cancel()
		return nil, fmt.Errorf("start sing-box service: %w", err)
	}
	return &officialSingBox{
		instance: instance,
		cancel:   cancel,
		traffic:  service.PtrFromContext[trafficcontrol.Manager](ctx),
	}, nil
}

func (s *officialSingBox) stats() (int64, int64) {
	if s.traffic == nil {
		return 0, 0
	}
	return s.traffic.Total()
}

func (s *officialSingBox) ruleIndex() map[adapter.Rule]int {
	rules := s.instance.Router().Rules()
	index := make(map[adapter.Rule]int, len(rules))
	for position, rule := range rules {
		index[rule] = position
	}
	return index
}

func (s *officialSingBox) ruleHits() ([]int, bool) {
	if s.traffic == nil {
		return nil, false
	}
	index := s.ruleIndex()
	hits := make([]int, len(index)+1)
	for _, connection := range s.traffic.Connections() {
		if connection.Rule == nil {
			hits[len(index)]++
		} else if position, ok := index[connection.Rule]; ok {
			hits[position]++
		}
	}
	return hits, true
}

func (s *officialSingBox) connections() []ConnectionInfo {
	if s.traffic == nil {
		return nil
	}
	index := s.ruleIndex()
	open := s.traffic.Connections()
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
	return result
}

func (s *officialSingBox) closeConnection(id string) error {
	if s.traffic == nil {
		return nil
	}
	if id == "" {
		s.traffic.CloseAllConnections()
		return nil
	}
	parsed, err := uuid.FromString(id)
	if err != nil {
		return fmt.Errorf("not a connection id: %q", id)
	}
	if tracker := s.traffic.Connection(parsed); tracker != nil {
		return tracker.Close()
	}
	return nil
}

func (s *officialSingBox) close() error {
	s.cancel()
	return s.instance.Close()
}

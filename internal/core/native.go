package core

import (
	"github.com/Rigby-Foundation/Kage/internal/xrayruntime"
	"sync"
)

type LogSink = xrayruntime.LogSink

// Instance owns the one Xray runtime. Platform setup only supplies an OS tunnel
// descriptor on mobile; desktop TUN, routes and socket binding belong to Xray.
type Instance struct {
	mu      sync.Mutex
	runtime xrayruntime.Instance
	cleanup func()
}

func (i *Instance) Running() bool                         { return i.runtime.Running() }
func (i *Instance) Stats() (int64, int64, bool)           { return i.runtime.Stats() }
func (i *Instance) RuleHits() ([]int, bool)               { return i.runtime.RuleHits() }
func (i *Instance) Connections() ([]ConnectionInfo, bool) { return i.runtime.Connections() }
func (i *Instance) CloseConnection(id string) error       { return i.runtime.CloseConnection(id) }
func (i *Instance) Start(config []byte, sink LogSink) error {
	return i.StartConfigured(config, "", 0, sink)
}
func (i *Instance) StartConfigured(config []byte, script string, rules int, sink LogSink) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if err := i.stopLocked(); err != nil {
		return err
	}
	config, err := sanitizeXray(config)
	if err != nil {
		return err
	}
	config, cleanup, err := preparePlatform(config)
	if err != nil {
		return err
	}
	if err = i.runtime.StartConfig(config, script, rules, sink); err != nil {
		cleanup()
		return err
	}
	i.cleanup = cleanup
	return nil
}
func (i *Instance) Stop() error { i.mu.Lock(); defer i.mu.Unlock(); return i.stopLocked() }
func (i *Instance) stopLocked() error {
	err := i.runtime.Stop()
	if i.cleanup != nil {
		i.cleanup()
		i.cleanup = nil
	}
	return err
}

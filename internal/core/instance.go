package core

import (
	"context"
	"fmt"
	"sync"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/log"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"
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
}

// Running reports whether a sing-box instance is currently up.
func (i *Instance) Running() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.instance != nil
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

	// Cancelling first unblocks in-flight dials so Close returns promptly.
	if cancel != nil {
		cancel()
	}
	return instance.Close()
}

//go:build ios

package ios

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/common/trafficcontrol"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"
)

var (
	tunnelRunMu sync.Mutex
	instance    *box.Box
	cancelFn    context.CancelFunc
	traffic     *trafficcontrol.Manager
)

// extensionMemoryLimit keeps the Go heap well under what iOS allows a packet
// tunnel extension (about 50 MB in all, code and Go's own overhead included).
// Going over gets the extension killed without a word: the tunnel just
// stops. A soft limit makes the collector work harder as it nears it instead.
const extensionMemoryLimit = 32 << 20

func StartTunnel(configJSON []byte, fd int) error {
	tunnelRunMu.Lock()
	defer tunnelRunMu.Unlock()

	debug.SetMemoryLimit(extensionMemoryLimit)

	if instance != nil {
		_ = stopTunnelLocked()
	}

	SetTunnelFD(fd)

	platform := NewPlatform()
	ctx := service.ContextWith[adapter.PlatformInterface](include.Context(context.Background()), platform)
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, configJSON)
	if err != nil {
		return fmt.Errorf("invalid sing-box config: %w", err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	boxInstance, err := box.New(box.Options{
		Context: runCtx,
		Options: options,
	})
	if err != nil {
		cancel()
		return fmt.Errorf("create sing-box: %w", err)
	}

	if err := boxInstance.Start(); err != nil {
		_ = boxInstance.Close()
		cancel()
		return fmt.Errorf("start sing-box: %w", err)
	}

	instance = boxInstance
	cancelFn = cancel
	traffic = service.PtrFromContext[trafficcontrol.Manager](runCtx)
	return nil
}

func StopTunnel() {
	tunnelRunMu.Lock()
	defer tunnelRunMu.Unlock()
	_ = stopTunnelLocked()
}

func stopTunnelLocked() error {
	if instance == nil {
		return nil
	}
	inst := instance
	cancel := cancelFn
	instance = nil
	cancelFn = nil
	traffic = nil

	if cancel != nil {
		cancel()
	}
	err := inst.Close()
	SetTunnelFD(-1)
	return err
}

func TunnelStats() (up, down int64) {
	tunnelRunMu.Lock()
	defer tunnelRunMu.Unlock()
	if traffic == nil {
		return 0, 0
	}
	u, d := traffic.Total()
	return u, d
}

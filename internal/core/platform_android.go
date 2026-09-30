//go:build android

package core

import (
	"context"
	"fmt"

	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing/service"

	"github.com/Rigby-Foundation/NuggetVPN/internal/android"
)

// withPlatform gives the built-in core Android's VpnService for its tunnel.
func withPlatform(ctx context.Context) context.Context {
	return service.ContextWith[adapter.PlatformInterface](ctx, android.NewPlatform())
}

// platformStopped lets Android end the VPN service once the core is down.
func platformStopped() { android.StopVPN() }

// coreAvailable reports whether a core can run here. Official sing-box and
// mihomo would each need their own VpnService wiring; the built-in core,
// and Xray behind it, have it.
func coreAvailable(name string) error {
	switch name {
	case "", CoreBuiltin, CoreXray:
		return nil
	}
	return fmt.Errorf("%s is not available on Android yet; use the built-in core or Xray", name)
}

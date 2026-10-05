//go:build ios

package core

import (
	"context"

	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing/service"

	"github.com/Rigby-Foundation/NuggetVPN/internal/ios"
)

// withPlatform gives the built-in core iOS's NetworkExtension platform.
func withPlatform(ctx context.Context) context.Context {
	return service.ContextWith[adapter.PlatformInterface](ctx, ios.NewPlatform())
}

// platformStopped cleans up once the core is down.
func platformStopped() {}

// coreAvailable reports whether a core can run here.
func coreAvailable(name string) error {
	switch name {
	case "", CoreBuiltin, CoreXray:
		return nil
	}
	return nil
}

//go:build with_wireguard

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/endpoint"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/wireguard"
)

func registerWireGuardEndpoint(registry *endpoint.Registry) {
	wireguard.RegisterEndpoint(registry)
}

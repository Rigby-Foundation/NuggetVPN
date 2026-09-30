//go:build with_openconnect

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/endpoint"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/openconnect"
)

func registerOpenConnectEndpoint(registry *endpoint.Registry) {
	openconnect.RegisterEndpoint(registry)
}

func registerOpenConnectDNSTransport(registry *dns.TransportRegistry) {
	openconnect.RegisterDNSTransport(registry)
}

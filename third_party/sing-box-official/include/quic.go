//go:build with_quic

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/inbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/outbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport/quic"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/hysteria"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/hysteria2"
	_ "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/naive/quic"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/tuic"
	_ "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/transport/v2rayquic"
)

func registerQUICInbounds(registry *inbound.Registry) {
	hysteria.RegisterInbound(registry)
	tuic.RegisterInbound(registry)
	hysteria2.RegisterInbound(registry)
}

func registerQUICOutbounds(registry *outbound.Registry) {
	hysteria.RegisterOutbound(registry)
	tuic.RegisterOutbound(registry)
	hysteria2.RegisterOutbound(registry)
}

func registerQUICTransports(registry *dns.TransportRegistry) {
	quic.RegisterTransport(registry)
	quic.RegisterHTTP3Transport(registry)
}

func registerQUICServices(registry *service.Registry) {
	hysteria2.RegisterRealmService(registry)
}

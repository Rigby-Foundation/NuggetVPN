//go:build !with_openvpn

package include

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/endpoint"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
)

func registerOpenVPNEndpoints(registry *endpoint.Registry) {
	endpoint.Register[option.OpenVPNClientEndpointOptions](registry, C.TypeOpenVPNClient, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.OpenVPNClientEndpointOptions) (adapter.Endpoint, error) {
		return nil, E.New(`OpenVPN is not included in this build, rebuild with -tags with_openvpn`)
	})
	endpoint.Register[option.OpenVPNServerEndpointOptions](registry, C.TypeOpenVPNServer, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.OpenVPNServerEndpointOptions) (adapter.Endpoint, error) {
		return nil, E.New(`OpenVPN is not included in this build, rebuild with -tags with_openvpn`)
	})
}

func registerOpenVPNDNSTransport(registry *dns.TransportRegistry) {
	dns.RegisterTransport[option.OpenVPNDNSServerOptions](registry, C.DNSTypeOpenVPN, func(ctx context.Context, logger log.ContextLogger, tag string, options option.OpenVPNDNSServerOptions) (adapter.DNSTransport, error) {
		return nil, E.New(`OpenVPN is not included in this build, rebuild with -tags with_openvpn`)
	})
}

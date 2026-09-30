//go:build !with_tailscale

package include

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/certificate"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/endpoint"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/inbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/outbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
)

func registerTailscaleEndpoint(registry *endpoint.Registry) {
	endpoint.Register[option.TailscaleEndpointOptions](registry, C.TypeTailscale, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.TailscaleEndpointOptions) (adapter.Endpoint, error) {
		return nil, E.New(`Tailscale is not included in this build, rebuild with -tags with_tailscale`)
	})
}

func registerTailcatInbound(registry *inbound.Registry) {
	inbound.Register[option.TailcatInboundOptions](registry, C.TypeTailcat, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.TailcatInboundOptions) (adapter.Inbound, error) {
		return nil, E.New(`Tailcat is not included in this build, rebuild with -tags with_tailscale`)
	})
}

func registerTailcatOutbound(registry *outbound.Registry) {
	outbound.Register[option.TailcatOutboundOptions](registry, C.TypeTailcat, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.TailcatOutboundOptions) (adapter.Outbound, error) {
		return nil, E.New(`Tailcat is not included in this build, rebuild with -tags with_tailscale`)
	})
}

func registerTailscaleTransport(registry *dns.TransportRegistry) {
	dns.RegisterTransport[option.TailscaleDNSServerOptions](registry, C.DNSTypeTailscale, func(ctx context.Context, logger log.ContextLogger, tag string, options option.TailscaleDNSServerOptions) (adapter.DNSTransport, error) {
		return nil, E.New(`Tailscale is not included in this build, rebuild with -tags with_tailscale`)
	})
}

func registerTailscaleCertificateProvider(registry *certificate.Registry) {
	certificate.Register[option.TailscaleCertificateProviderOptions](registry, C.TypeTailscale, func(ctx context.Context, logger log.ContextLogger, tag string, options option.TailscaleCertificateProviderOptions) (adapter.CertificateProviderService, error) {
		return nil, E.New(`Tailscale is not included in this build, rebuild with -tags with_tailscale`)
	})
}

func registerDERPService(registry *service.Registry) {
	service.Register[option.DERPServiceOptions](registry, C.TypeDERP, func(ctx context.Context, logger log.ContextLogger, tag string, options option.DERPServiceOptions) (adapter.Service, error) {
		return nil, E.New(`DERP is not included in this build, rebuild with -tags with_tailscale`)
	})
}

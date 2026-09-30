package include

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/certificate"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/endpoint"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/inbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/outbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport/fakeip"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport/hosts"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport/local"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/dns/transport/mdns"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/anytls"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/block"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/bridge"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/direct"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/group"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/http"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/masque"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/mixed"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/naive"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/redirect"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/shadowsocks"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/shadowtls"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/snell"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/socks"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/ssh"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/tor"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/trojan"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/tun"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/vless"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/vmess"
	originca "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/origin_ca"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/resolved"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/ssmapi"
	E "github.com/sagernet/sing/common/exceptions"
)

func Context(ctx context.Context) context.Context {
	return box.Context(ctx, InboundRegistry(), OutboundRegistry(), EndpointRegistry(), DNSTransportRegistry(), ServiceRegistry(), CertificateProviderRegistry())
}

func InboundRegistry() *inbound.Registry {
	registry := inbound.NewRegistry()

	tun.RegisterInbound(registry)
	redirect.RegisterRedirect(registry)
	redirect.RegisterTProxy(registry)
	direct.RegisterInbound(registry)

	socks.RegisterInbound(registry)
	http.RegisterInbound(registry)
	mixed.RegisterInbound(registry)

	shadowsocks.RegisterInbound(registry)
	snell.RegisterInbound(registry)
	vmess.RegisterInbound(registry)
	trojan.RegisterInbound(registry)
	naive.RegisterInbound(registry)
	shadowtls.RegisterInbound(registry)
	vless.RegisterInbound(registry)
	anytls.RegisterInbound(registry)

	registerQUICInbounds(registry)
	registerCloudflaredInbound(registry)
	registerTailcatInbound(registry)
	registerStubForRemovedInbounds(registry)

	return registry
}

func OutboundRegistry() *outbound.Registry {
	registry := outbound.NewRegistry()

	direct.RegisterOutbound(registry)
	bridge.RegisterOutbound(registry)

	block.RegisterOutbound(registry)

	group.RegisterSelector(registry)
	group.RegisterURLTest(registry)

	socks.RegisterOutbound(registry)
	http.RegisterOutbound(registry)
	shadowsocks.RegisterOutbound(registry)
	snell.RegisterOutbound(registry)
	vmess.RegisterOutbound(registry)
	trojan.RegisterOutbound(registry)
	registerNaiveOutbound(registry)
	tor.RegisterOutbound(registry)
	ssh.RegisterOutbound(registry)
	shadowtls.RegisterOutbound(registry)
	vless.RegisterOutbound(registry)
	anytls.RegisterOutbound(registry)

	registerQUICOutbounds(registry)
	registerTailcatOutbound(registry)
	registerStubForRemovedOutbounds(registry)

	return registry
}

func EndpointRegistry() *endpoint.Registry {
	registry := endpoint.NewRegistry()

	registerWireGuardEndpoint(registry)
	registerOpenConnectEndpoint(registry)
	registerOpenVPNEndpoints(registry)
	masque.RegisterEndpoint(registry)
	registerTailscaleEndpoint(registry)

	return registry
}

func DNSTransportRegistry() *dns.TransportRegistry {
	registry := dns.NewTransportRegistry()

	transport.RegisterTCP(registry)
	transport.RegisterUDP(registry)
	transport.RegisterTLS(registry)
	transport.RegisterHTTPS(registry)
	hosts.RegisterTransport(registry)
	local.RegisterTransport(registry)
	mdns.RegisterTransport(registry)
	fakeip.RegisterTransport(registry)
	resolved.RegisterTransport(registry)

	registerQUICTransports(registry)
	registerDHCPTransport(registry)
	registerTailscaleTransport(registry)
	registerOpenConnectDNSTransport(registry)
	registerOpenVPNDNSTransport(registry)

	return registry
}

func ServiceRegistry() *service.Registry {
	registry := service.NewRegistry()

	resolved.RegisterService(registry)
	ssmapi.RegisterService(registry)

	registerQUICServices(registry)
	registerDERPService(registry)
	registerCCMService(registry)
	registerOCMService(registry)
	registerOOMKillerService(registry)
	registerUSBIPServices(registry)

	return registry
}

func CertificateProviderRegistry() *certificate.Registry {
	registry := certificate.NewRegistry()

	registerACMECertificateProvider(registry)
	registerTailscaleCertificateProvider(registry)
	originca.RegisterCertificateProvider(registry)

	return registry
}

func registerStubForRemovedInbounds(registry *inbound.Registry) {
	inbound.Register[option.ShadowsocksInboundOptions](registry, C.TypeShadowsocksR, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.ShadowsocksInboundOptions) (adapter.Inbound, error) {
		return nil, E.New("ShadowsocksR is deprecated and removed in sing-box 1.6.0")
	})
}

func registerStubForRemovedOutbounds(registry *outbound.Registry) {
	outbound.Register[option.ShadowsocksROutboundOptions](registry, C.TypeShadowsocksR, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.ShadowsocksROutboundOptions) (adapter.Outbound, error) {
		return nil, E.New("ShadowsocksR is deprecated and removed in sing-box 1.6.0")
	})
	outbound.Register[option.StubOptions](registry, C.TypeWireGuard, func(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.StubOptions) (adapter.Outbound, error) {
		return nil, E.New("WireGuard outbound is deprecated in sing-box 1.11.0 and removed in sing-box 1.13.0, use WireGuard endpoint instead")
	})
}

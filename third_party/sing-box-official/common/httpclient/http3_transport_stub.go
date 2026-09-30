//go:build !with_quic

package httpclient

import (
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/common/tls"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
	N "github.com/sagernet/sing/common/network"
)

func newHTTP3FallbackTransport(
	rawDialer N.Dialer,
	baseTLSConfig tls.Config,
	h2Fallback innerTransport,
	options option.QUICOptions,
	fallbackDelay time.Duration,
) (innerTransport, error) {
	return nil, E.New("HTTP/3 requires building with the with_quic tag")
}

func newHTTP3Transport(
	rawDialer N.Dialer,
	baseTLSConfig tls.Config,
	options option.QUICOptions,
) (innerTransport, error) {
	return nil, E.New("HTTP/3 requires building with the with_quic tag")
}

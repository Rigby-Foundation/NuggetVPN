//go:build !darwin || !cgo

package tls

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
	"github.com/sagernet/sing/common/logger"
)

func newAppleClient(ctx context.Context, logger logger.ContextLogger, serverAddress string, options option.OutboundTLSOptions, allowEmptyServerName bool) (Config, error) {
	return nil, E.New("Apple TLS engine is not available on non-Apple platforms")
}

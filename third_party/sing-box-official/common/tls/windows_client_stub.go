//go:build !windows

package tls

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
	"github.com/sagernet/sing/common/logger"
)

func newWindowsClient(ctx context.Context, logger logger.ContextLogger, serverAddress string, options option.OutboundTLSOptions, allowEmptyServerName bool) (Config, error) {
	return nil, E.New("Windows TLS engine is not available on non-Windows platforms")
}

//go:build with_cloudflared

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/inbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/cloudflare"
)

func registerCloudflaredInbound(registry *inbound.Registry) {
	cloudflare.RegisterInbound(registry)
}

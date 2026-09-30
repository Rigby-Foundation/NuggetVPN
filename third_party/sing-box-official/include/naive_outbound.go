//go:build with_naive_outbound

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/outbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/protocol/naive"
)

func registerNaiveOutbound(registry *outbound.Registry) {
	naive.RegisterOutbound(registry)
}

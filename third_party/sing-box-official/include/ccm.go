//go:build with_ccm && (!darwin || cgo)

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/ccm"
)

func registerCCMService(registry *service.Registry) {
	ccm.RegisterService(registry)
}

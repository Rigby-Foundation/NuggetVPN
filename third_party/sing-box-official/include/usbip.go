//go:build with_usbip && (linux || (darwin && cgo) || windows)

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/usbip"
)

func registerUSBIPServices(registry *service.Registry) {
	usbip.RegisterService(registry)
}

//go:build !linux

package tun

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-tun-official"
	E "github.com/sagernet/sing/common/exceptions"
)

func newPlatformAutoRedirect(inbound *Inbound) (tun.AutoRedirect, error) {
	return nil, E.New("platform auto-redirect is only supported on Linux")
}

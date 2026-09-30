//go:build !with_quic

package networkquality

import (
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	N "github.com/sagernet/sing/common/network"
)

func NewHTTP3MeasurementClientFactory(dialer N.Dialer) (MeasurementClientFactory, error) {
	return nil, C.ErrQUICNotIncluded
}

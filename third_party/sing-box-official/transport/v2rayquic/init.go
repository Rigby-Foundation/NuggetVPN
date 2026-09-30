//go:build with_quic

package v2rayquic

import "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/transport/v2ray"

func init() {
	v2ray.RegisterQUICConstructor(NewServer, NewClient)
}

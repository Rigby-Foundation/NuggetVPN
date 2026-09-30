//go:build !(darwin || dragonfly || freebsd || netbsd || openbsd)

package listener

import (
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
)

func UDPSocketBufferSize() int {
	return C.UDPSocketBufferSize
}

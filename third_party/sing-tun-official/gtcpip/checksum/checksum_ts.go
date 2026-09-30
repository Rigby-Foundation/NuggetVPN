//go:build amd64 || arm64

package checksum

import "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-tun-official/internal/tschecksum"

func Checksum(buf []byte, initial uint16) uint16 {
	return tschecksum.Checksum(buf, initial)
}

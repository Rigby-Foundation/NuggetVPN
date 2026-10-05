//go:build ios

package main

import (
	"C"

	"github.com/Rigby-Foundation/NuggetVPN/internal/ios"
)

// For iOS builds we export functions for WailsAppDelegate and PacketTunnelProvider.

//export WailsIOSMain
func WailsIOSMain() {
	main()
}

//export StartPacketTunnel
func StartPacketTunnel(config *C.char, fd C.int) *C.char {
	confStr := C.GoString(config)
	if err := ios.StartTunnel([]byte(confStr), int(fd)); err != nil {
		return C.CString(err.Error())
	}
	return nil
}

//export StopPacketTunnel
func StopPacketTunnel() {
	ios.StopTunnel()
}

//export GetPacketTunnelStats
func GetPacketTunnelStats(up *C.longlong, down *C.longlong) {
	u, d := ios.TunnelStats()
	if up != nil {
		*up = C.longlong(u)
	}
	if down != nil {
		*down = C.longlong(d)
	}
}

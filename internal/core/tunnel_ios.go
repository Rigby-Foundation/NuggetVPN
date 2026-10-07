//go:build ios

package core

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework NetworkExtension -framework Foundation
#include <stdlib.h>

char *NuggetVPN_StartTunnel(const char *configJSON);
int NuggetVPN_StopTunnel(void);
int NuggetVPN_GetStatus(void);
void NuggetVPN_GetStats(long long *up, long long *down);
*/
import "C"
import (
	"errors"
	"sync/atomic"
	"time"
	"unsafe"
)

// iosExpectUp is set while the app means the tunnel to be up: from a start
// that iOS confirmed until the app stops it. A tunnel that goes down in
// between went down by itself.
var iosExpectUp atomic.Bool

// NEVPNStatus values.
const (
	iosStatusConnecting  = 2
	iosStatusConnected   = 3
	iosStatusReasserting = 4
)

func StartTunnelIOS(configJSON []byte) error {
	cStr := C.CString(string(configJSON))
	defer C.free(unsafe.Pointer(cStr))

	errStr := C.NuggetVPN_StartTunnel(cStr)
	if errStr != nil {
		defer C.free(unsafe.Pointer(errStr))
		return errors.New(C.GoString(errStr))
	}
	iosExpectUp.Store(true)
	return nil
}

func StopTunnelIOS() error {
	iosExpectUp.Store(false)
	C.NuggetVPN_StopTunnel()
	return nil
}

func GetTunnelStatusIOS() int {
	return int(C.NuggetVPN_GetStatus())
}

func GetTunnelStatsIOS() (int64, int64) {
	var up, down C.longlong
	C.NuggetVPN_GetStats(&up, &down)
	return int64(up), int64(down)
}

func (c *Client) startStatsTickerIOS() {
	ticker := time.NewTicker(1 * time.Second)
	go func() {
		for range ticker.C {
			switch GetTunnelStatusIOS() {
			case iosStatusConnected, iosStatusConnecting, iosStatusReasserting:
				up, down := GetTunnelStatsIOS()
				c.dispatchEvent(EventStats, "", "", true, up, down)
			default:
				// The extension stopped without being asked: it failed,
				// iOS ended it (memory), or the VPN was turned off in
				// Settings. Say so, so the app stops showing "connected".
				if iosExpectUp.CompareAndSwap(true, false) {
					c.dispatchEvent(EventState, "", "", false, 0, 0)
				}
			}
		}
	}()
}

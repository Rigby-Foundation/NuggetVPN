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
	"time"
	"unsafe"
)

func StartTunnelIOS(configJSON []byte) error {
	cStr := C.CString(string(configJSON))
	defer C.free(unsafe.Pointer(cStr))

	errStr := C.NuggetVPN_StartTunnel(cStr)
	if errStr != nil {
		defer C.free(unsafe.Pointer(errStr))
		return errors.New(C.GoString(errStr))
	}
	return nil
}

func StopTunnelIOS() error {
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
			if !c.Running() {
				continue
			}
			up, down := GetTunnelStatsIOS()
			c.dispatchEvent(EventStats, "", "", true, up, down)
		}
	}()
}

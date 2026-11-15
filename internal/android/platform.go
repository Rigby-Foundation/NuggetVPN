//go:build android

package android

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync"
	"syscall"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/transport/internet"
	"golang.org/x/sys/unix"
)

var installXrayPlatform sync.Once

// StartTunnel obtains Android's VpnService descriptor for Xray's native TUN.
func StartTunnel(config []byte) (func(), error) {
	var root struct {
		Inbounds []struct {
			Protocol string `json:"protocol"`
			Settings struct {
				MTU     uint32   `json:"MTU"`
				Gateway []string `json:"gateway"`
				DNS     []string `json:"dns"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(config, &root); err != nil {
		return nil, err
	}
	for _, inbound := range root.Inbounds {
		if inbound.Protocol != "tun" {
			continue
		}
		installXrayPlatform.Do(func() {
			_ = internet.RegisterDialerController(func(network, address string, c syscall.RawConn) error {
				var protectErr error
				if err := c.Control(func(fd uintptr) {
					if !Protect(int(fd)) {
						protectErr = errors.New("Android could not protect Xray's socket")
					}
				}); err != nil {
					return err
				}
				return protectErr
			})
			xnet.RegisterAndroidProcessFinder(func(network, srcIP string, srcPort uint16, dstIP string, dstPort uint16) (int, string, string, error) {
				protocol := 6
				if network == "udp" {
					protocol = 17
				}
				data, _ := json.Marshal(map[string]any{"protocol": protocol, "source": srcIP, "source_port": srcPort, "destination": dstIP, "destination_port": dstPort})
				answer, err := call("findConnectionOwner", string(data))
				if err != nil {
					return 0, "", "", err
				}
				var owner struct {
					UID      int
					Packages []string
					Error    string
				}
				if err = json.Unmarshal([]byte(answer), &owner); err != nil {
					return 0, "", "", err
				}
				if owner.Error != "" {
					return 0, "", "", errors.New(owner.Error)
				}
				name := ""
				if len(owner.Packages) > 0 {
					name = owner.Packages[0]
				}
				return owner.UID, name, name, nil
			})
		})
		request := map[string]any{"mtu": inbound.Settings.MTU, "addresses": inbound.Settings.Gateway, "routes": []string{"0.0.0.0/0", "::/0"}, "dns": inbound.Settings.DNS}
		data, _ := json.Marshal(request)
		answer, err := call("openTun", string(data))
		if err != nil {
			return nil, err
		}
		var result struct {
			FD    int    `json:"fd"`
			Error string `json:"error"`
		}
		if err = json.Unmarshal([]byte(answer), &result); err != nil {
			return nil, err
		}
		if result.Error != "" {
			return nil, errors.New(result.Error)
		}
		if result.FD < 0 {
			return nil, fmt.Errorf("Android returned an invalid tunnel descriptor")
		}
		if err = os.Setenv("XRAY_TUN_FD", strconv.Itoa(result.FD)); err != nil {
			_ = unix.Close(result.FD)
			StopVPN()
			return nil, err
		}
		return func() { _ = unix.Close(result.FD); _ = os.Unsetenv("XRAY_TUN_FD"); StopVPN() }, nil
	}
	return func() {}, nil
}

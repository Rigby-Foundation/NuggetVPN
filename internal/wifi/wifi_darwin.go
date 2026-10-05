//go:build darwin && !ios

package wifi

import (
	"context"
	"os/exec"
	"strings"
)

func hide(*exec.Cmd) {}

func current(ctx context.Context) (Network, error) {
	device := wifiDevice(ctx)
	if device == "" {
		return Network{}, nil // no Wi-Fi hardware
	}
	// ipconfig's summary names the network; newer systems write <redacted>
	// in its place for programs not allowed to use location.
	if output, err := run(ctx, "ipconfig", "getsummary", device); err == nil {
		if ssid, ok := field(output, "SSID"); ok {
			if ssid == "" || strings.Contains(ssid, "redacted") {
				return Network{OnWifi: true}, ErrHidden
			}
			return Network{OnWifi: true, SSID: ssid}, nil
		}
	}
	output, err := run(ctx, "networksetup", "-getairportnetwork", device)
	if err != nil {
		return Network{}, ErrUnsupported
	}
	if _, name, ok := strings.Cut(output, "Current Wi-Fi Network:"); ok {
		return Network{OnWifi: true, SSID: strings.TrimSpace(name)}, nil
	}
	return Network{}, nil
}

// wifiDevice finds the Wi-Fi interface, usually en0.
func wifiDevice(ctx context.Context) string {
	output, err := run(ctx, "networksetup", "-listallhardwareports")
	if err != nil {
		return ""
	}
	lines := strings.Split(output, "\n")
	for index, line := range lines {
		if strings.Contains(line, "Wi-Fi") || strings.Contains(line, "AirPort") {
			for _, next := range lines[index+1:] {
				if device, ok := strings.CutPrefix(strings.TrimSpace(next), "Device:"); ok {
					return strings.TrimSpace(device)
				}
			}
		}
	}
	return ""
}

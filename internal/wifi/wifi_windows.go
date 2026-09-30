//go:build windows

package wifi

import (
	"context"
	"os/exec"
	"strings"
	"syscall"
)

func hide(command *exec.Cmd) {
	// CREATE_NO_WINDOW: no console flashing up every few seconds.
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func current(ctx context.Context) (Network, error) {
	output, err := run(ctx, "netsh", "wlan", "show", "interfaces")
	if err != nil && output == "" {
		return Network{}, nil // no wireless service: not on Wi-Fi
	}
	return parseNetsh(output)
}

// parseNetsh reads `netsh wlan show interfaces`. The field names are not
// translated, whatever the system's language; the values are. A connected
// interface has an SSID line; since Windows 11 24H2 it is left out, with a
// note about location, for programs not allowed to use location.
func parseNetsh(output string) (Network, error) {
	if ssid, ok := field(output, "SSID"); ok && ssid != "" {
		return Network{OnWifi: true, SSID: ssid}, nil
	}
	if _, connected := field(output, "BSSID"); connected {
		return Network{OnWifi: true}, ErrHidden
	}
	if strings.Contains(strings.ToLower(output), "location") {
		// Cannot tell whether it is connected at all; say what would help.
		return Network{}, ErrHidden
	}
	return Network{}, nil
}

//go:build linux

package wifi

import (
	"context"
	"os/exec"
	"strings"
)

func hide(*exec.Cmd) {}

func current(ctx context.Context) (Network, error) {
	// NetworkManager, which nearly every desktop uses.
	if output, err := run(ctx, "nmcli", "-t", "-f", "active,ssid", "dev", "wifi"); err == nil {
		return parseNmcli(output), nil
	}
	// Otherwise the wireless tools, where installed.
	if output, err := run(ctx, "iwgetid", "-r"); err == nil {
		ssid := strings.TrimSpace(output)
		return Network{OnWifi: ssid != "", SSID: ssid}, nil
	}
	return Network{}, ErrUnsupported
}

// parseNmcli reads "yes:Name" lines; colons in a name come escaped as "\:".
func parseNmcli(output string) Network {
	for _, line := range strings.Split(output, "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "yes:"); ok && rest != "" {
			return Network{OnWifi: true, SSID: strings.ReplaceAll(rest, `\:`, ":")}
		}
	}
	return Network{}
}

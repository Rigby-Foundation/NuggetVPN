//go:build windows

package wifi

import (
	"errors"
	"testing"
)

func TestParseNetsh(t *testing.T) {
	connected := `
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX201 160MHz
    State                  : connected
    SSID                   : Home: 5G
    BSSID                  : aa:bb:cc:dd:ee:ff
    Network type           : Infrastructure
`
	if network, err := parseNetsh(connected); err != nil || network.SSID != "Home: 5G" || !network.OnWifi {
		t.Errorf("connected: %+v %v", network, err)
	}
	hidden := `
    Name                   : Wi-Fi
    State                  : connected
    BSSID                  : aa:bb:cc:dd:ee:ff
`
	if network, err := parseNetsh(hidden); !errors.Is(err, ErrHidden) || !network.OnWifi {
		t.Errorf("hidden: %+v %v", network, err)
	}
	if network, err := parseNetsh("There is no wireless interface on the system."); err != nil || network.OnWifi {
		t.Errorf("none: %+v %v", network, err)
	}
}

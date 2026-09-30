//go:build linux

package wifi

import "testing"

func TestParseNmcli(t *testing.T) {
	if network := parseNmcli("no:Other\n" + `yes:Cafe\: guest` + "\n"); network.SSID != "Cafe: guest" {
		t.Errorf("%+v", network)
	}
	if network := parseNmcli("no:Other\n"); network.OnWifi {
		t.Errorf("%+v", network)
	}
}

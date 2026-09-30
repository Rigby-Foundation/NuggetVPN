// Package wifi reads the name of the Wi-Fi network this computer is on.
//
// Every system guards it differently, and newer ones treat it as location
// data: Windows 11 24H2 and macOS 14.4 only hand it to programs allowed to
// use location. So a failure here is an ordinary outcome, reported as
// ErrHidden, not a fault.
package wifi

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

// Network is what Current found.
type Network struct {
	// OnWifi is false on a cable, or with no network at all.
	OnWifi bool `json:"on_wifi"`
	// SSID is the network's name; empty when OnWifi is false.
	SSID string `json:"ssid"`
}

// ErrHidden means the computer is on Wi-Fi but the system would not say
// which network: usually location access is off for the app.
var ErrHidden = errors.New("the system is not sharing the Wi-Fi network's name")

// ErrUnsupported means there is no way to ask on this system.
var ErrUnsupported = errors.New("cannot read the Wi-Fi network on this system")

// Current reports the Wi-Fi network this computer is on.
func Current() (Network, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return current(ctx)
}

// run runs a command and returns its output, or "" if it fails.
func run(ctx context.Context, name string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, name, args...)
	hide(command)
	output, err := command.Output()
	return string(output), err
}

// field returns the value after "key :" on the first line whose key is
// exactly key, ignoring spaces around it.
func field(output, key string) (string, bool) {
	for _, line := range strings.Split(output, "\n") {
		name, value, found := strings.Cut(line, ":")
		if found && strings.TrimSpace(name) == key {
			return strings.TrimSpace(value), true
		}
	}
	return "", false
}

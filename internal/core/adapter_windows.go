//go:build windows

package core

import (
	"net"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// tunAdapterName is what every core names the tunnel's adapter (see
// sbconfig.tunInterfaceNameFor and the mihomo config's device).
const tunAdapterName = "NuggetVPN"

// removeStaleAdapter deletes a "NuggetVPN" adapter left behind while no
// tunnel is running. A core normally removes its adapter when it stops, but
// one that was killed, crashed or switched for another core can leave it; it
// then sits in Network Connections, and the next tunnel cannot take its name
// ("a duplicate name exists on the network"), so connecting fails until a
// restart. Call it only while the core is stopped.
func removeStaleAdapter(logf func(string)) {
	// A core that just stopped may still be taking its adapter down.
	for wait := 0; wait < 10; wait++ {
		if _, err := net.InterfaceByName(tunAdapterName); err != nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	logf("Removing the leftover " + tunAdapterName + " network adapter")
	// The adapter's device, by its connection name, removed the way Device
	// Manager would.
	script := "$a = Get-NetAdapter -Name '" + tunAdapterName + "' -IncludeHidden -ErrorAction SilentlyContinue; " +
		"if ($a) { pnputil /remove-device $a.PnPDeviceID | Out-Null }"
	command := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	if output, err := command.CombinedOutput(); err != nil {
		logf("WARN could not remove the leftover adapter: " + strings.TrimSpace(string(output)) + " " + err.Error())
	}
}

// adapterNameTaken reports a start that failed because a leftover adapter
// still holds the tunnel's name.
func adapterNameTaken(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate name")
}

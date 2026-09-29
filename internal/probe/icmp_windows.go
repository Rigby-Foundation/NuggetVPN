//go:build windows

package probe

import (
	"encoding/binary"
	"net"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Pinging through the ICMP API rather than ping.exe.
//
// This app is a GUI program, and Windows gives every console program a GUI
// program starts its own console window. ping.exe is one, so probing a
// subscription opened a terminal per server, twelve at a time, and again every
// thirty seconds while Proxies was open. It also measured the wrong thing: the
// clock ran around the whole process launch, so every result included
// ping.exe starting up.
//
// IcmpSendEcho needs no administrator rights, starts nothing, and reports the
// round trip the network stack measured itself.

var (
	iphlpapi            = windows.NewLazySystemDLL("iphlpapi.dll")
	procIcmpCreateFile  = iphlpapi.NewProc("IcmpCreateFile")
	procIcmpCloseHandle = iphlpapi.NewProc("IcmpCloseHandle")
	procIcmpSendEcho    = iphlpapi.NewProc("IcmpSendEcho")
)

// ipSuccess is IP_SUCCESS, the reply status for an answered echo.
const ipSuccess = 0

// icmpEchoReply mirrors ICMP_ECHO_REPLY. Only the leading fields are read;
// the trailing pointers make its size differ between 32- and 64-bit builds,
// which is why the reply buffer is sized generously rather than exactly.
type icmpEchoReply struct {
	Address       uint32
	Status        uint32
	RoundTripTime uint32
	DataSize      uint16
	Reserved      uint16
}

// echoPayload is the request body. Its content does not matter; its size
// sets how much room the reply needs.
var echoPayload = []byte("nuggetvpn-probe!")

// nativeICMP pings an IPv4 address through the ICMP API. It reports ok=false
// when this path cannot handle the address, so the caller falls back.
func nativeICMP(address string, timeout time.Duration) (result *uint64, ok bool) {
	ip := net.ParseIP(address).To4()
	if ip == nil {
		// IPv6 needs Icmp6SendEcho2 and its own address structures; it is
		// rare enough for a server that the hidden ping.exe fallback serves.
		return nil, false
	}
	if procIcmpSendEcho.Find() != nil {
		return nil, false
	}

	handle, _, _ := procIcmpCreateFile.Call()
	if windows.Handle(handle) == windows.InvalidHandle {
		return nil, false
	}
	defer procIcmpCloseHandle.Call(handle)

	// ICMP_ECHO_REPLY, the echoed payload, and room for an ICMP error
	// message — with slack for the platform-sized pointers in the struct.
	reply := make([]byte, 64+len(echoPayload)+8+64)

	// IPAddr is an in_addr: the four octets in network order, read in place.
	destination := binary.LittleEndian.Uint32(ip)

	milliseconds := uint32(timeout.Milliseconds())
	if milliseconds == 0 {
		milliseconds = 1
	}

	replies, _, _ := procIcmpSendEcho.Call(
		handle,
		uintptr(destination),
		uintptr(unsafe.Pointer(&echoPayload[0])),
		uintptr(len(echoPayload)),
		0,
		uintptr(unsafe.Pointer(&reply[0])),
		uintptr(len(reply)),
		uintptr(milliseconds),
	)
	if replies == 0 {
		// No reply within the timeout, or unreachable: a measured failure,
		// not a reason to try ping.exe as well.
		return nil, true
	}

	echo := (*icmpEchoReply)(unsafe.Pointer(&reply[0]))
	if echo.Status != ipSuccess {
		return nil, true
	}
	elapsed := uint64(echo.RoundTripTime)
	return &elapsed, true
}

// hideConsole stops a console program started by this GUI app from opening
// a window of its own.
func hideConsole(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
}

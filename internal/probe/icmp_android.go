//go:build android

package probe

import (
	"net"
	"os/exec"
	"syscall"
	"time"

	"github.com/Rigby-Foundation/NuggetVPN/internal/android"
)

// Pinging from Go on Android.
//
// An app runs the system ping as itself, which works from a shell but not
// from the app's own sandbox, so every server read n/a. Android lets any app
// open a datagram ICMP socket instead (ping_group_range covers every group):
// the kernel fills in the identifier and checksum and hands back only this
// socket's replies. The socket is protected, so while connected the echo goes
// to the server directly rather than into the tunnel.

func init() {
	dialControl = func(_, _ string, conn syscall.RawConn) error {
		return conn.Control(func(fd uintptr) { android.Protect(int(fd)) })
	}
}

func nativeICMP(address string, timeout time.Duration) (*uint64, bool) {
	ip := net.ParseIP(address)
	if ip == nil {
		return nil, true
	}

	family, protocol, request, reply := syscall.AF_INET6, syscall.IPPROTO_ICMPV6, byte(128), byte(129)
	var to syscall.Sockaddr
	if v4 := ip.To4(); v4 != nil {
		family, protocol, request, reply = syscall.AF_INET, syscall.IPPROTO_ICMP, 8, 0
		sockaddr := &syscall.SockaddrInet4{}
		copy(sockaddr.Addr[:], v4)
		to = sockaddr
	} else {
		sockaddr := &syscall.SockaddrInet6{}
		copy(sockaddr.Addr[:], ip.To16())
		to = sockaddr
	}

	fd, err := syscall.Socket(family, syscall.SOCK_DGRAM|syscall.SOCK_CLOEXEC, protocol)
	if err != nil {
		return nil, false
	}
	defer syscall.Close(fd)
	if !android.Protect(fd) {
		return nil, true
	}

	// Type, code, checksum, identifier (the kernel's), sequence, payload.
	const sequence = 1
	packet := append([]byte{request, 0, 0, 0, 0, 0, 0, sequence}, echoPayload...)

	start := time.Now()
	deadline := start.Add(timeout)
	if err := syscall.Sendto(fd, packet, 0, to); err != nil {
		return nil, true
	}

	buffer := make([]byte, 1500)
	for {
		left := time.Until(deadline)
		if left <= 0 {
			return nil, true
		}
		wait := syscall.NsecToTimeval(left.Nanoseconds())
		if err := syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &wait); err != nil {
			return nil, true
		}
		n, _, err := syscall.Recvfrom(fd, buffer, 0)
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			return nil, true
		}
		if n >= 8 && buffer[0] == reply && buffer[7] == sequence {
			elapsed := uint64(time.Since(start).Milliseconds())
			return &elapsed, true
		}
	}
}

// echoPayload is the request body; its content does not matter.
var echoPayload = []byte("nuggetvpn-probe!")

func hideConsole(*exec.Cmd) {}

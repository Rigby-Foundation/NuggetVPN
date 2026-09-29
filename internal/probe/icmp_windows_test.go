//go:build windows

package probe

import (
	"testing"
	"time"
)

func TestNativeICMPAnswersLoopback(t *testing.T) {
	result, ok := nativeICMP("127.0.0.1", time.Second)
	if !ok {
		t.Fatal("the ICMP API should handle an IPv4 address, not fall back to ping.exe")
	}
	if result == nil {
		t.Fatal("loopback should answer")
	}
}

func TestNativeICMPReportsSilenceAsAMeasurement(t *testing.T) {
	// 192.0.2.0/24 is reserved for documentation and never answers. A timeout
	// is a result in its own right: falling back to ping.exe here would open
	// the window this code exists to avoid.
	start := time.Now()
	result, ok := nativeICMP("192.0.2.1", 300*time.Millisecond)
	if !ok {
		t.Fatal("a timeout must not trigger the ping.exe fallback")
	}
	if result != nil {
		t.Fatalf("an unroutable address answered in %d ms", *result)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Errorf("the timeout was not honoured: took %s", elapsed)
	}
}

func TestNativeICMPLeavesIPv6ToTheFallback(t *testing.T) {
	if _, ok := nativeICMP("::1", time.Second); ok {
		t.Error("IPv6 is not handled natively and should fall back")
	}
}

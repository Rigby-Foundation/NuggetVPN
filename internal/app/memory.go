package app

import (
	"runtime/debug"
	"sync/atomic"
	"time"
)

var releasing atomic.Bool

// releaseMemory hands memory freed by a large one-off job back to the
// system, in the background and at most once at a time. A forced collection
// costs a few milliseconds; it is worth it only after work that allocated a
// lot and kept none of it — connecting, refreshing subscriptions.
func releaseMemory() {
	if !releasing.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer releasing.Store(false)
		// Let the caller's last references go out of scope first.
		time.Sleep(time.Second)
		debug.FreeOSMemory()
	}()
}

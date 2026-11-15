//go:build ios

package app

import "C"

// UIKit can deliver a cold-launch URL before the Go service has started.
var iosImportLinks = make(chan string, 1)

//export KageIOSOpenURL
func KageIOSOpenURL(raw *C.char) {
	link := C.GoString(raw)
	if _, ok := ParseDeepLink(link); !ok {
		return
	}
	// UIKit calls this on the main thread. Keep the newest pending link.
	select {
	case <-iosImportLinks:
	default:
	}
	iosImportLinks <- link
}

func (a *App) registerURLScheme() {
	// The schemes themselves are registered in the iOS application's plist.
	go func() {
		for {
			select {
			case link := <-iosImportLinks:
				a.receiveLinks(link)
			case <-a.context().Done():
				return
			}
		}
	}()
}

//go:build windows

package app

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                = windows.NewLazySystemDLL("user32.dll")
	procRegisterHotKey    = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey  = user32.NewProc("UnregisterHotKey")
	procGetMessageW       = user32.NewProc("GetMessageW")
	procPostThreadMessage = user32.NewProc("PostThreadMessageW")
)

const (
	modAlt      = 0x0001
	modControl  = 0x0002
	modShift    = 0x0004
	modWin      = 0x0008
	modNoRepeat = 0x4000

	wmHotkey = 0x0312
	wmQuit   = 0x0012

	hotkeyID = 1
)

// errHotkeyAlreadyRegistered is ERROR_HOTKEY_ALREADY_REGISTERED: another app
// holds the combination.
var errHotkeyAlreadyRegistered = windows.Errno(1409)

type winMessage struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	x, y    int32
}

// hotkeyThread is the thread that owns the registration: Windows delivers a
// hotkey to the thread that registered it, through that thread's message
// queue, so it needs one of its own that does nothing else.
var hotkeyThread struct {
	sync.Mutex
	id uint32
}

// registerHotkey replaces the registered shortcut with spec; empty removes it.
func (a *App) registerHotkey(spec string) error {
	hotkeyThread.Lock()
	defer hotkeyThread.Unlock()

	if hotkeyThread.id != 0 {
		procPostThreadMessage.Call(uintptr(hotkeyThread.id), wmQuit, 0, 0)
		hotkeyThread.id = 0
	}
	if spec == "" {
		return nil
	}
	parsed, err := parseHotkey(spec)
	if err != nil {
		return err
	}
	vk, _ := virtualKey(parsed.key)
	modifiers := uintptr(modNoRepeat)
	if parsed.alt {
		modifiers |= modAlt
	}
	if parsed.ctrl {
		modifiers |= modControl
	}
	if parsed.shift {
		modifiers |= modShift
	}
	if parsed.super {
		modifiers |= modWin
	}

	started := make(chan error, 1)
	threadID := make(chan uint32, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		ok, _, callErr := procRegisterHotKey.Call(0, hotkeyID, modifiers, uintptr(vk))
		if ok == 0 {
			if errors.Is(callErr, errHotkeyAlreadyRegistered) {
				started <- fmt.Errorf("%s is already used by another app", spec)
			} else {
				started <- fmt.Errorf("could not register %s: %w", spec, callErr)
			}
			return
		}
		defer procUnregisterHotKey.Call(0, hotkeyID)
		threadID <- windows.GetCurrentThreadId()
		started <- nil

		var message winMessage
		for {
			result, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
			// 0 is WM_QUIT, -1 an error: either way, stop.
			if int32(result) <= 0 {
				return
			}
			if message.message == wmHotkey {
				go a.toggleFromShortcut()
			}
		}
	}()
	if err := <-started; err != nil {
		return err
	}
	hotkeyThread.id = <-threadID
	return nil
}

// hotkeysSupported reports whether a global shortcut can be registered.
func hotkeysSupported() bool { return true }

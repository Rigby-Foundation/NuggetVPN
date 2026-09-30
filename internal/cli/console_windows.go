//go:build windows

package cli

import (
	"os"

	"golang.org/x/sys/windows"
)

// attachConsole gives the program a place to print. The app is built as a
// window program, which Windows starts with no console; a terminal that
// started it is still there to attach to. Output that is already going
// somewhere, such as a pipe or a file, is left alone.
func attachConsole() {
	if handle, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE); err == nil && handle != 0 && handle != windows.InvalidHandle {
		if kind, err := windows.GetFileType(handle); err == nil && kind != windows.FILE_TYPE_UNKNOWN {
			return
		}
	}
	const attachParent = ^uint32(0) // ATTACH_PARENT_PROCESS
	kernel := windows.NewLazySystemDLL("kernel32.dll")
	if result, _, _ := kernel.NewProc("AttachConsole").Call(uintptr(attachParent)); result == 0 {
		return
	}
	if out, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = out, out
		// The terminal printed its prompt when the program started; begin
		// on a line of our own.
		_, _ = out.WriteString("\r\n")
	}
}

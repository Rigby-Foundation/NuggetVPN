//go:build android

package android

/*
#cgo LDFLAGS: -llog
#include <android/log.h>
#include <stdlib.h>

static void nvpn_log(int priority, const char* line) {
	__android_log_write(priority, "GoLog", line);
}
*/
import "C"

import (
	"bufio"
	"os"
	"unsafe"

	"golang.org/x/sys/unix"
)

// Android discards a process's standard output and error, so a panic or a
// log.Fatal would leave nothing behind but "exited (1)". Both are sent to
// logcat instead, under the tag GoLog, from the moment the library loads.
func init() {
	redirect(1, C.ANDROID_LOG_INFO)
	redirect(2, C.ANDROID_LOG_ERROR)
}

func redirect(fd int, priority C.int) {
	var pipe [2]int
	if err := unix.Pipe(pipe[:]); err != nil {
		return
	}
	if err := unix.Dup2(pipe[1], fd); err != nil {
		unix.Close(pipe[0])
		unix.Close(pipe[1])
		return
	}
	unix.Close(pipe[1])
	reader := os.NewFile(uintptr(pipe[0]), "logcat")
	go func() {
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
		for scanner.Scan() {
			line := C.CString(scanner.Text())
			C.nvpn_log(priority, line)
			C.free(unsafe.Pointer(line))
		}
	}()
}

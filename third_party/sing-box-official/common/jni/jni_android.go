//go:build android

package jni

/*
#include <stdint.h>
extern uintptr_t nvpn_box_jni_vm(void);
*/
import "C"

func VM() uintptr {
	return uintptr(C.nvpn_box_jni_vm())
}

#include <jni.h>
#include <stdint.h>

// NuggetVPN: a library has one JNI_OnLoad, and the built-in core (the
// sing-box fork linked beside this copy) defines it. Ask the fork for the VM
// it was given.
extern uintptr_t box_jni_vm(void);

uintptr_t nvpn_box_jni_vm(void) {
	return box_jni_vm();
}

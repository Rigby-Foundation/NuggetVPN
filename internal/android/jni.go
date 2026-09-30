//go:build android

// Package android is the app's side of its Android host: the JNI bridge to
// the Java code in build/android, and the sing-box platform interface that
// gets the tunnel from Android's VpnService.
//
// Java starts it: NuggetBridge.attach() hands Go the bridge object, and from
// then on Go calls its methods by name and Java calls back through the native
// methods exported here.
package android

/*
#cgo LDFLAGS: -llog
#include <jni.h>
#include <stdlib.h>
#include <string.h>

static JavaVM* nvpn_vm = NULL;
static jobject nvpn_bridge = NULL;

static void nvpn_attach(JNIEnv* env, jobject bridge) {
	(*env)->GetJavaVM(env, &nvpn_vm);
	if (nvpn_bridge != NULL) {
		(*env)->DeleteGlobalRef(env, nvpn_bridge);
	}
	nvpn_bridge = (*env)->NewGlobalRef(env, bridge);
}

static int nvpn_ready(void) {
	return nvpn_vm != NULL && nvpn_bridge != NULL;
}

// nvpn_env returns this thread's JNIEnv, attaching the thread if it is not
// yet known to the VM; *detach says whether the caller must detach it.
static JNIEnv* nvpn_env(int* detach) {
	JNIEnv* env = NULL;
	*detach = 0;
	if (nvpn_vm == NULL) return NULL;
	jint result = (*nvpn_vm)->GetEnv(nvpn_vm, (void**)&env, JNI_VERSION_1_6);
	if (result == JNI_EDETACHED) {
		if ((*nvpn_vm)->AttachCurrentThread(nvpn_vm, &env, NULL) != 0) return NULL;
		*detach = 1;
	} else if (result != JNI_OK) {
		return NULL;
	}
	return env;
}

static void nvpn_release(int detach) {
	if (detach) (*nvpn_vm)->DetachCurrentThread(nvpn_vm);
}

static int nvpn_failed(JNIEnv* env) {
	if ((*env)->ExceptionCheck(env)) {
		(*env)->ExceptionDescribe(env);
		(*env)->ExceptionClear(env);
		return 1;
	}
	return 0;
}

// String name(String): the result in malloc'd memory, or NULL.
static char* nvpn_call_string(const char* name, const char* arg) {
	int detach;
	JNIEnv* env = nvpn_env(&detach);
	if (env == NULL || nvpn_bridge == NULL) return NULL;
	char* out = NULL;
	jclass cls = (*env)->GetObjectClass(env, nvpn_bridge);
	jmethodID method = (*env)->GetMethodID(env, cls, name, "(Ljava/lang/String;)Ljava/lang/String;");
	if (method != NULL && !nvpn_failed(env)) {
		jstring jarg = (*env)->NewStringUTF(env, arg);
		jstring result = (jstring)(*env)->CallObjectMethod(env, nvpn_bridge, method, jarg);
		if (!nvpn_failed(env) && result != NULL) {
			const char* chars = (*env)->GetStringUTFChars(env, result, NULL);
			if (chars != NULL) {
				out = strdup(chars);
				(*env)->ReleaseStringUTFChars(env, result, chars);
			}
			(*env)->DeleteLocalRef(env, result);
		}
		(*env)->DeleteLocalRef(env, jarg);
	} else {
		nvpn_failed(env);
	}
	(*env)->DeleteLocalRef(env, cls);
	nvpn_release(detach);
	return out;
}

// boolean name(int)
static int nvpn_call_bool_int(const char* name, int arg) {
	int detach;
	JNIEnv* env = nvpn_env(&detach);
	if (env == NULL || nvpn_bridge == NULL) return 0;
	int out = 0;
	jclass cls = (*env)->GetObjectClass(env, nvpn_bridge);
	jmethodID method = (*env)->GetMethodID(env, cls, name, "(I)Z");
	if (method != NULL && !nvpn_failed(env)) {
		jboolean result = (*env)->CallBooleanMethod(env, nvpn_bridge, method, (jint)arg);
		out = !nvpn_failed(env) && result == JNI_TRUE;
	} else {
		nvpn_failed(env);
	}
	(*env)->DeleteLocalRef(env, cls);
	nvpn_release(detach);
	return out;
}

static char* nvpn_jstring(JNIEnv* env, jstring value) {
	if (value == NULL) return strdup("");
	const char* chars = (*env)->GetStringUTFChars(env, value, NULL);
	char* out = strdup(chars != NULL ? chars : "");
	if (chars != NULL) (*env)->ReleaseStringUTFChars(env, value, chars);
	return out;
}
*/
import "C"

import (
	"encoding/json"
	"errors"
	"runtime"
	"sync"
	"unsafe"
)

// ErrNotReady means the Java side has not attached: the app is not running
// in its Android host.
var ErrNotReady = errors.New("the Android host is not ready")

// Ready reports whether Java has attached the bridge.
func Ready() bool { return C.nvpn_ready() != 0 }

// call invokes String name(String) on the Java bridge.
func call(name, arg string) (string, error) {
	if !Ready() {
		return "", ErrNotReady
	}
	// A JNI env belongs to one OS thread; stay on it for the call.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	cname, carg := C.CString(name), C.CString(arg)
	defer C.free(unsafe.Pointer(cname))
	defer C.free(unsafe.Pointer(carg))
	result := C.nvpn_call_string(cname, carg)
	if result == nil {
		return "", errors.New("android: " + name + " failed")
	}
	defer C.free(unsafe.Pointer(result))
	return C.GoString(result), nil
}

// callBool invokes boolean name(int) on the Java bridge.
func callBool(name string, arg int) bool {
	if !Ready() {
		return false
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	cname := C.CString(name)
	defer C.free(unsafe.Pointer(cname))
	return C.nvpn_call_bool_int(cname, C.int(arg)) != 0
}

// Callbacks from Java.
var (
	callbacksMu      sync.Mutex
	onDefaultNetwork func(name string, index int, expensive, constrained bool)
	onRevoked        func()
	onLink           func(string)
	pendingLinks     []string
)

//export Java_com_wails_app_NuggetBridge_nativeAttach
func Java_com_wails_app_NuggetBridge_nativeAttach(env *C.JNIEnv, class C.jclass, bridge C.jobject) {
	C.nvpn_attach(env, bridge)
}

//export Java_com_wails_app_NuggetBridge_nativeDefaultNetwork
func Java_com_wails_app_NuggetBridge_nativeDefaultNetwork(env *C.JNIEnv, class C.jclass, name C.jstring, index C.jint, expensive C.jboolean, constrained C.jboolean) {
	cname := C.nvpn_jstring(env, name)
	goName := C.GoString(cname)
	C.free(unsafe.Pointer(cname))
	callbacksMu.Lock()
	handler := onDefaultNetwork
	callbacksMu.Unlock()
	if handler != nil {
		// Off the Java thread: the handler may call back into Java.
		go handler(goName, int(index), expensive == C.JNI_TRUE, constrained == C.JNI_TRUE)
	}
}

//export Java_com_wails_app_NuggetBridge_nativeRevoked
func Java_com_wails_app_NuggetBridge_nativeRevoked(env *C.JNIEnv, class C.jclass) {
	callbacksMu.Lock()
	handler := onRevoked
	callbacksMu.Unlock()
	if handler != nil {
		go handler()
	}
}

//export Java_com_wails_app_NuggetBridge_nativeOpenLink
func Java_com_wails_app_NuggetBridge_nativeOpenLink(env *C.JNIEnv, class C.jclass, link C.jstring) {
	clink := C.nvpn_jstring(env, link)
	goLink := C.GoString(clink)
	C.free(unsafe.Pointer(clink))
	callbacksMu.Lock()
	handler := onLink
	if handler == nil {
		pendingLinks = append(pendingLinks, goLink)
	}
	callbacksMu.Unlock()
	if handler != nil {
		go handler(goLink)
	}
}

// OnLink receives nuggetvpn:// links the app was opened with, including any
// that arrived before it was ready.
func OnLink(handler func(link string)) {
	callbacksMu.Lock()
	onLink = handler
	pending := pendingLinks
	pendingLinks = nil
	callbacksMu.Unlock()
	for _, link := range pending {
		go handler(link)
	}
}

// OnRevoked is called when Android takes the VPN away: another VPN app
// started, or the user turned it off in the system settings.
func OnRevoked(handler func()) {
	callbacksMu.Lock()
	onRevoked = handler
	callbacksMu.Unlock()
}

// StopVPN ends the VPN service once the core has closed the tunnel.
func StopVPN() {
	_, _ = call("stopVpn", "")
}

// SetSystemBars colours the status and navigation bars, as #RRGGBB, with
// dark icons for a light colour.
func SetSystemBars(color string, light bool) {
	data, _ := json.Marshal(map[string]any{"color": color, "light": light})
	_, _ = call("setSystemBars", string(data))
}

// SystemPalette is the device's Material You palette as JSON, or "" before
// Android 12 or outside the Android host.
func SystemPalette() string {
	palette, err := call("systemPalette", "")
	if err != nil {
		return ""
	}
	return palette
}

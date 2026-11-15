//go:build darwin && !ios && !server && !production

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static void kageEnableWebViewDevtools(void *nativeWindow) {
    if (nativeWindow == NULL) return;
    dispatch_async(dispatch_get_main_queue(), ^{
        @try {
            NSWindow *window = (NSWindow *)nativeWindow;
            WKWebView *webView = [window valueForKey:@"webView"];
            // inspectable exposes the page to Safari; developerExtrasEnabled
            // also enables WebKit's inspector inside the application's window.
            [webView.configuration.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
            if (@available(macOS 13.3, *)) {
                webView.inspectable = YES;
            }
        } @catch (NSException *exception) {
            NSLog(@"[Kage] Could not enable WebView developer tools: %@", exception.reason);
        }
    });
}
*/
import "C"

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func configureWebViewDevtools(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		C.kageEnableWebViewDevtools(window.NativeWindow())
	})
}

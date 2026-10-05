// Minimal bootstrap: delegate comes from Go archive (WailsAppDelegate)
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <stdio.h>

@interface WailsAppDelegate : UIResponder <UIApplicationDelegate>
@property (strong, nonatomic) UIWindow *window;
@end

@interface WailsViewController : UIViewController
@property (nonatomic, strong) WKWebView *webView;
@end

@implementation WailsViewController (EdgeToEdge)

- (void)nugget_viewDidLayoutSubviews {
    [self nugget_viewDidLayoutSubviews];
    // Force webView to be true edge-to-edge (covering status bar and home indicator)
    if (self.webView) {
        self.webView.frame = self.view.bounds;
        self.webView.opaque = NO;
        self.webView.backgroundColor = [UIColor clearColor];
        self.webView.scrollView.backgroundColor = [UIColor clearColor];
        if (@available(iOS 11.0, *)) {
            self.webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
        }
    }
}

@end

static void SwizzleWailsViewController(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class cls = objc_getClass("WailsViewController");
        if (!cls) return;
        Method originalMethod = class_getInstanceMethod(cls, @selector(viewDidLayoutSubviews));
        Method swizzledMethod = class_getInstanceMethod(cls, @selector(nugget_viewDidLayoutSubviews));
        if (originalMethod && swizzledMethod) {
            method_exchangeImplementations(originalMethod, swizzledMethod);
        }
    });
}

@interface WailsSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (strong, nonatomic) UIWindow *window;
@end

@implementation WailsSceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:[UIWindowScene class]]) return;
    UIWindowScene *windowScene = (UIWindowScene *)scene;

    SwizzleWailsViewController();

    UIColor *themeBg = [UIColor colorWithRed:20.0/255.0 green:9.0/255.0 blue:13.0/255.0 alpha:1.0];

    WailsAppDelegate *delegate = (WailsAppDelegate *)[UIApplication sharedApplication].delegate;
    if (delegate && delegate.window) {
        delegate.window.windowScene = windowScene;
        self.window = delegate.window;
    } else {
        self.window = [[UIWindow alloc] initWithWindowScene:windowScene];
        if (delegate) {
            delegate.window = self.window;
        }
    }
    self.window.backgroundColor = themeBg;
    if (self.window.rootViewController) {
        self.window.rootViewController.view.backgroundColor = themeBg;
    }
    [self.window makeKeyAndVisible];
}
@end

@interface WailsAppDelegate (SceneLifecycle)
- (UISceneConfiguration *)application:(UIApplication *)application configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession options:(UISceneConnectionOptions *)options;
@end

@implementation WailsAppDelegate (SceneLifecycle)
- (UISceneConfiguration *)application:(UIApplication *)application configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *config = [[UISceneConfiguration alloc] initWithName:@"Default Configuration" sessionRole:connectingSceneSession.role];
    config.delegateClass = [WailsSceneDelegate class];
    return config;
}
@end

#import "NuggetVPNManager.h"

int main(int argc, char * argv[]) {
    @autoreleasepool {
        // Disable buffering so stdout/stderr from Go log.Printf flush immediately
        setvbuf(stdout, NULL, _IONBF, 0);
        setvbuf(stderr, NULL, _IONBF, 0);

        // Force the linker to preserve delegates and controllers
        [WailsAppDelegate class];
        [WailsSceneDelegate class];
        [WailsViewController class];
        [NuggetVPNManager class];
        SwizzleWailsViewController();

        return UIApplicationMain(argc, argv, nil, NSStringFromClass([WailsAppDelegate class]));
    }
}

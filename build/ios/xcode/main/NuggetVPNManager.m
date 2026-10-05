#import "NuggetVPNManager.h"

@interface NuggetVPNManager ()
@property (nonatomic, strong, nullable) NETunnelProviderManager *vpnManager;
@end

@implementation NuggetVPNManager

+ (instancetype)sharedManager {
    static NuggetVPNManager *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[NuggetVPNManager alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        [self loadManagerWithCompletion:^(NETunnelProviderManager * _Nullable manager) {}];
    }
    return self;
}

- (void)loadManagerWithCompletion:(void (^)(NETunnelProviderManager * _Nullable manager))completion {
    if (self.vpnManager) {
        if (completion) completion(self.vpnManager);
        return;
    }
    [NETunnelProviderManager loadAllFromPreferencesWithCompletionHandler:^(NSArray<NETunnelProviderManager *> * _Nullable managers, NSError * _Nullable error) {
        if (error) {
            NSLog(@"[NuggetVPNManager] loadAllFromPreferences error: %@", error);
        }
        NETunnelProviderManager *matched = nil;
        for (NETunnelProviderManager *m in managers) {
            if ([m.protocolConfiguration isKindOfClass:[NETunnelProviderProtocol class]]) {
                NETunnelProviderProtocol *p = (NETunnelProviderProtocol *)m.protocolConfiguration;
                if ([p.providerBundleIdentifier isEqualToString:@"org.rigbyfoundation.nuggetvpn.PacketTunnel"]) {
                    matched = m;
                    break;
                }
            }
        }
        if (!matched && managers.count > 0) {
            matched = managers.firstObject;
        }
        if (!matched) {
            matched = [[NETunnelProviderManager alloc] init];
        }

        NETunnelProviderProtocol *protocol = (NETunnelProviderProtocol *)matched.protocolConfiguration;
        if (!protocol || ![protocol isKindOfClass:[NETunnelProviderProtocol class]]) {
            protocol = [[NETunnelProviderProtocol alloc] init];
            matched.protocolConfiguration = protocol;
        }
        protocol.providerBundleIdentifier = @"org.rigbyfoundation.nuggetvpn.PacketTunnel";
        protocol.serverAddress = @"NuggetVPN";
        matched.localizedDescription = @"NuggetVPN";
        matched.enabled = YES;

        self.vpnManager = matched;
        if (completion) completion(self.vpnManager);
    }];
}

- (void)startWithConfig:(NSString *)configJSON completion:(void (^)(NSError * _Nullable error))completion {
    [self loadManagerWithCompletion:^(NETunnelProviderManager * _Nullable manager) {
        if (!manager) {
            if (completion) completion([NSError errorWithDomain:@"org.rigbyfoundation.nuggetvpn" code:-1 userInfo:@{NSLocalizedDescriptionKey: @"Could not initialize NETunnelProviderManager"}]);
            return;
        }

        NETunnelProviderProtocol *protocol = (NETunnelProviderProtocol *)manager.protocolConfiguration;
        if (!protocol || ![protocol isKindOfClass:[NETunnelProviderProtocol class]]) {
            protocol = [[NETunnelProviderProtocol alloc] init];
            manager.protocolConfiguration = protocol;
        }
        protocol.providerBundleIdentifier = @"org.rigbyfoundation.nuggetvpn.PacketTunnel";
        protocol.serverAddress = @"127.0.0.1";
        manager.localizedDescription = @"NuggetVPN";
        manager.enabled = YES;

        // Share config file via App Group container
        NSURL *groupURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:@"group.org.rigbyfoundation.nuggetvpn"];
        if (groupURL) {
            NSURL *configFileURL = [groupURL URLByAppendingPathComponent:@"tunnel_config.json"];
            [configJSON writeToURL:configFileURL atomically:YES encoding:NSUTF8StringEncoding error:nil];
        }

        [manager saveToPreferencesWithCompletionHandler:^(NSError * _Nullable saveError) {
            if (saveError) {
                NSLog(@"[NuggetVPNManager] saveToPreferences error: %@", saveError);
                if (completion) completion(saveError);
                return;
            }

            [manager loadFromPreferencesWithCompletionHandler:^(NSError * _Nullable loadError) {
                if (loadError) {
                    NSLog(@"[NuggetVPNManager] loadFromPreferences error: %@", loadError);
                    if (completion) completion(loadError);
                    return;
                }

                NSError *startError = nil;
                NSDictionary *options = @{ @"config": configJSON ?: @"" };
                BOOL started = [manager.connection startVPNTunnelWithOptions:options andReturnError:&startError];
                if (!started && startError) {
                    NSLog(@"[NuggetVPNManager] startVPNTunnel error: %@", startError);
                    if (completion) completion(startError);
                } else {
                    NSLog(@"[NuggetVPNManager] VPN Tunnel start requested successfully");
                    if (completion) completion(nil);
                }
            }];
        }];
    }];
}

- (void)stopWithCompletion:(void (^)(NSError * _Nullable error))completion {
    if (self.vpnManager) {
        [self.vpnManager.connection stopVPNTunnel];
    }
    if (completion) completion(nil);
}

- (NEVPNStatus)status {
    if (!self.vpnManager) return NEVPNStatusInvalid;
    return self.vpnManager.connection.status;
}

- (void)queryStatsWithCompletion:(void (^)(int64_t up, int64_t down))completion {
    if (!self.vpnManager || self.vpnManager.connection.status != NEVPNStatusConnected) {
        if (completion) completion(0, 0);
        return;
    }
    if ([self.vpnManager.connection isKindOfClass:[NETunnelProviderSession class]]) {
        NETunnelProviderSession *session = (NETunnelProviderSession *)self.vpnManager.connection;
        NSData *message = [@"stats" dataUsingEncoding:NSUTF8StringEncoding];
        [session sendProviderMessage:message returnError:nil responseHandler:^(NSData * _Nullable responseData) {
            if (responseData) {
                NSDictionary *dict = [NSJSONSerialization JSONObjectWithData:responseData options:0 error:nil];
                int64_t up = [dict[@"up"] longLongValue];
                int64_t down = [dict[@"down"] longLongValue];
                if (completion) completion(up, down);
                return;
            }
            if (completion) completion(0, 0);
        }];
        return;
    }
    if (completion) completion(0, 0);
}

@end

// C-linkable wrappers
char *NuggetVPN_StartTunnel(const char *configJSON) {
    if (!configJSON) return strdup("Configuration is empty");
    NSString *configStr = [NSString stringWithUTF8String:configJSON];

    __block NSString *errorString = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[NuggetVPNManager sharedManager] startWithConfig:configStr completion:^(NSError * _Nullable error) {
        if (error) {
#if TARGET_OS_SIMULATOR
            if (error.code == 5 /* IPC failed */) {
                errorString = @"iOS Simulator does not support NetworkExtension VPN tunnels (IPC failed). Please test on a physical iOS device.";
            } else {
                errorString = [NSString stringWithFormat:@"NetworkExtension error: %@ (code %ld)", error.localizedDescription, (long)error.code];
            }
#else
            errorString = [NSString stringWithFormat:@"NetworkExtension error: %@ (code %ld)", error.localizedDescription, (long)error.code];
#endif
        }
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    if (errorString) {
        return strdup([errorString UTF8String]);
    }
    return NULL;
}

int NuggetVPN_StopTunnel(void) {
    [[NuggetVPNManager sharedManager] stopWithCompletion:^(NSError * _Nullable error) {}];
    return 0;
}

int NuggetVPN_GetStatus(void) {
    return (int)[[NuggetVPNManager sharedManager] status];
}

void NuggetVPN_GetStats(long long *up, long long *down) {
    __block long long u = 0, d = 0;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[NuggetVPNManager sharedManager] queryStatsWithCompletion:^(int64_t uVal, int64_t dVal) {
        u = uVal;
        d = dVal;
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.8 * NSEC_PER_SEC)));

    if (up) *up = u;
    if (down) *down = d;
}

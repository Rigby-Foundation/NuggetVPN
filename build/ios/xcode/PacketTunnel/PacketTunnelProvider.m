#import <NetworkExtension/NetworkExtension.h>
#import "NuggetVPN.h"

@interface PacketTunnelProvider : NEPacketTunnelProvider
@end

@implementation PacketTunnelProvider

- (void)startTunnelWithOptions:(NSDictionary *)options completionHandler:(void (^)(NSError *))completionHandler {
    NSLog(@"[PacketTunnel] startTunnelWithOptions called");

    NSString *configString = options[@"config"];
    if (!configString || configString.length == 0) {
        NSURL *groupURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:@"group.org.rigbyfoundation.nuggetvpn"];
        if (groupURL) {
            NSURL *configFileURL = [groupURL URLByAppendingPathComponent:@"tunnel_config.json"];
            configString = [NSString stringWithContentsOfURL:configFileURL encoding:NSUTF8StringEncoding error:nil];
        }
    }

    if (!configString || configString.length == 0) {
        NSLog(@"[PacketTunnel] Error: empty configuration");
        completionHandler([NSError errorWithDomain:@"org.rigbyfoundation.nuggetvpn"
                                              code:101
                                          userInfo:@{NSLocalizedDescriptionKey: @"Missing or empty tunnel configuration"}]);
        return;
    }

    // Configure virtual network settings
    NEPacketTunnelNetworkSettings *settings = [[NEPacketTunnelNetworkSettings alloc] initWithTunnelRemoteAddress:@"127.0.0.1"];

    NEIPv4Settings *ipv4 = [[NEIPv4Settings alloc] initWithAddresses:@[@"172.19.0.1"] subnetMasks:@[@"255.255.255.0"]];
    ipv4.includedRoutes = @[[NEIPv4Route defaultRoute]];
    settings.IPv4Settings = ipv4;

    NEDNSSettings *dns = [[NEDNSSettings alloc] initWithServers:@[@"1.1.1.1", @"8.8.8.8"]];
    settings.DNSSettings = dns;
    settings.MTU = @(4064);

    [self setTunnelNetworkSettings:settings completionHandler:^(NSError * _Nullable error) {
        if (error) {
            NSLog(@"[PacketTunnel] setTunnelNetworkSettings failed: %@", error);
            completionHandler(error);
            return;
        }

        int tunFd = -1;
        @try {
            tunFd = [[self.packetFlow valueForKeyPath:@"_socket.fileDescriptor"] intValue];
        } @catch (NSException *ex) {
            NSLog(@"[PacketTunnel] Exception extracting tunFd: %@", ex);
        }

        if (tunFd <= 0) {
            @try {
                tunFd = [[self.packetFlow valueForKey:@"socket.fileDescriptor"] intValue];
            } @catch (NSException *ex) {
                NSLog(@"[PacketTunnel] Exception fallback extracting tunFd: %@", ex);
            }
        }

        if (tunFd <= 0) {
            NSLog(@"[PacketTunnel] Failed to get valid file descriptor from packetFlow");
            completionHandler([NSError errorWithDomain:@"org.rigbyfoundation.nuggetvpn"
                                                  code:102
                                              userInfo:@{NSLocalizedDescriptionKey: @"Could not get virtual tun file descriptor"}]);
            return;
        }

        NSLog(@"[PacketTunnel] Got valid tunFd=%d, starting sing-box tunnel...", tunFd);
        char *startErr = StartPacketTunnel((char *)[configString UTF8String], tunFd);
        if (startErr != NULL) {
            NSString *errMsg = [NSString stringWithUTF8String:startErr];
            NSLog(@"[PacketTunnel] StartPacketTunnel failed: %@", errMsg);
            completionHandler([NSError errorWithDomain:@"org.rigbyfoundation.nuggetvpn"
                                                  code:103
                                              userInfo:@{NSLocalizedDescriptionKey: errMsg}]);
            return;
        }

        NSLog(@"[PacketTunnel] Packet tunnel established successfully!");
        completionHandler(nil);
    }];
}

- (void)stopTunnelWithReason:(NEProviderStopReason)reason completionHandler:(void (^)(void))completionHandler {
    NSLog(@"[PacketTunnel] Stopping tunnel (reason: %ld)", (long)reason);
    StopPacketTunnel();
    completionHandler();
}

- (void)handleAppMessage:(NSData *)messageData completionHandler:(void (^)(NSData *))completionHandler {
    NSString *cmd = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];
    if ([cmd isEqualToString:@"stats"]) {
        long long up = 0, down = 0;
        GetPacketTunnelStats(&up, &down);
        NSDictionary *dict = @{@"up": @(up), @"down": @(down)};
        NSData *res = [NSJSONSerialization dataWithJSONObject:dict options:0 error:nil];
        completionHandler(res);
        return;
    }
    completionHandler(nil);
}

@end

// Stub implementations of main app manager functions so linker satisfies references from NuggetVPN.a
char *NuggetVPN_StartTunnel(const char *configJSON) { return NULL; }
int NuggetVPN_StopTunnel(void) { return -1; }
int NuggetVPN_GetStatus(void) { return 0; }
void NuggetVPN_GetStats(long long *up, long long *down) {
    if (up) *up = 0;
    if (down) *down = 0;
}

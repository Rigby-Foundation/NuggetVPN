#import <NetworkExtension/NetworkExtension.h>
#include <sys/socket.h>
#include <net/if.h>
#import "NuggetVPN.h"

// The utun control socket iOS made for this tunnel. Found the way WireGuard
// and sing-box's own iOS app find it: the open descriptor whose
// UTUN_OPT_IFNAME answers with a utun name. Reading it through the packet
// flow's private keys breaks between iOS releases.
#define NUGGET_SYSPROTO_CONTROL 2
#define NUGGET_UTUN_OPT_IFNAME 2
static int NuggetFindTunnelFD(void) {
    char name[IFNAMSIZ];
    for (int fd = 0; fd < 1024; fd++) {
        socklen_t length = sizeof(name);
        if (getsockopt(fd, NUGGET_SYSPROTO_CONTROL, NUGGET_UTUN_OPT_IFNAME, name, &length) == 0 && strncmp(name, "utun", 4) == 0) {
            return fd;
        }
    }
    return -1;
}

// An IPv4 netmask for a prefix length.
static NSString *NuggetMask(int prefix) {
    uint32_t mask = prefix <= 0 ? 0 : (prefix >= 32 ? 0xFFFFFFFF : (0xFFFFFFFFu << (32 - prefix)));
    return [NSString stringWithFormat:@"%u.%u.%u.%u", (mask >> 24) & 0xFF, (mask >> 16) & 0xFF, (mask >> 8) & 0xFF, mask & 0xFF];
}

// The interface settings, from the config's tun inbound: the same address
// and MTU sing-box is told, so iOS does not drop the packets sing-box sizes
// for its own MTU, and the local networks the config keeps off the tunnel.
static NEPacketTunnelNetworkSettings *NuggetSettingsFromConfig(NSString *configString) {
    NSArray *v4Addresses = @[@"172.19.0.1"], *v4Masks = @[@"255.255.255.252"];
    NSMutableArray<NSString *> *v6Addresses = [NSMutableArray array];
    NSMutableArray<NSNumber *> *v6Prefixes = [NSMutableArray array];
    NSMutableArray<NEIPv4Route *> *v4Excluded = [NSMutableArray array];
    NSMutableArray<NEIPv6Route *> *v6Excluded = [NSMutableArray array];
    NSNumber *mtu = @(9000);

    NSData *data = [configString dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *config = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    NSDictionary *tunInbound = nil;
    if ([config isKindOfClass:[NSDictionary class]]) {
        for (NSDictionary *inbound in config[@"inbounds"]) {
            if ([inbound isKindOfClass:[NSDictionary class]] && [inbound[@"type"] isEqual:@"tun"]) {
                tunInbound = inbound;
                break;
            }
        }
    }
    if (tunInbound) {
        if ([tunInbound[@"mtu"] isKindOfClass:[NSNumber class]] && [tunInbound[@"mtu"] intValue] > 0) {
            mtu = tunInbound[@"mtu"];
        }
        NSMutableArray *addresses4 = [NSMutableArray array], *masks4 = [NSMutableArray array];
        for (NSString *cidr in tunInbound[@"address"]) {
            NSArray *parts = [cidr componentsSeparatedByString:@"/"];
            if (parts.count != 2) continue;
            if ([parts[0] containsString:@":"]) {
                [v6Addresses addObject:parts[0]];
                [v6Prefixes addObject:@([parts[1] intValue])];
            } else {
                [addresses4 addObject:parts[0]];
                [masks4 addObject:NuggetMask([parts[1] intValue])];
            }
        }
        if (addresses4.count > 0) { v4Addresses = addresses4; v4Masks = masks4; }
        for (NSString *cidr in tunInbound[@"route_exclude_address"]) {
            NSArray *parts = [cidr componentsSeparatedByString:@"/"];
            if (parts.count != 2) continue;
            if ([parts[0] containsString:@":"]) {
                [v6Excluded addObject:[[NEIPv6Route alloc] initWithDestinationAddress:parts[0] networkPrefixLength:@([parts[1] intValue])]];
            } else {
                [v4Excluded addObject:[[NEIPv4Route alloc] initWithDestinationAddress:parts[0] subnetMask:NuggetMask([parts[1] intValue])]];
            }
        }
    }

    NEPacketTunnelNetworkSettings *settings = [[NEPacketTunnelNetworkSettings alloc] initWithTunnelRemoteAddress:@"127.0.0.1"];
    NEIPv4Settings *ipv4 = [[NEIPv4Settings alloc] initWithAddresses:v4Addresses subnetMasks:v4Masks];
    ipv4.includedRoutes = @[[NEIPv4Route defaultRoute]];
    ipv4.excludedRoutes = v4Excluded;
    settings.IPv4Settings = ipv4;
    if (v6Addresses.count > 0) {
        NEIPv6Settings *ipv6 = [[NEIPv6Settings alloc] initWithAddresses:v6Addresses networkPrefixLengths:v6Prefixes];
        ipv6.includedRoutes = @[[NEIPv6Route defaultRoute]];
        ipv6.excludedRoutes = v6Excluded;
        settings.IPv6Settings = ipv6;
    }
    // Any server works: the config hijacks DNS on port 53 inside the tunnel.
    NEDNSSettings *dns = [[NEDNSSettings alloc] initWithServers:@[@"1.1.1.1"]];
    dns.matchDomains = @[@""];
    settings.DNSSettings = dns;
    settings.MTU = mtu;
    return settings;
}

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

    NEPacketTunnelNetworkSettings *settings = NuggetSettingsFromConfig(configString);

    [self setTunnelNetworkSettings:settings completionHandler:^(NSError * _Nullable error) {
        if (error) {
            NSLog(@"[PacketTunnel] setTunnelNetworkSettings failed: %@", error);
            completionHandler(error);
            return;
        }

        int tunFd = NuggetFindTunnelFD();
        if (tunFd <= 0) {
            // Older iOS releases exposed it on the packet flow.
            @try {
                tunFd = [[self.packetFlow valueForKeyPath:@"socket.fileDescriptor"] intValue];
            } @catch (NSException *ex) {
                NSLog(@"[PacketTunnel] No descriptor on the packet flow: %@", ex);
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

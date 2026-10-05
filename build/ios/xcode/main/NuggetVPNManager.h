#import <Foundation/Foundation.h>
#import <NetworkExtension/NetworkExtension.h>

NS_ASSUME_NONNULL_BEGIN

@interface NuggetVPNManager : NSObject

+ (instancetype)sharedManager;

- (void)startWithConfig:(NSString *)configJSON completion:(void (^)(NSError * _Nullable error))completion;
- (void)stopWithCompletion:(void (^)(NSError * _Nullable error))completion;
- (NEVPNStatus)status;
- (void)queryStatsWithCompletion:(void (^)(int64_t up, int64_t down))completion;

@end

// C-linkable functions for Go/Cgo
char * _Nullable NuggetVPN_StartTunnel(const char *configJSON);
int NuggetVPN_StopTunnel(void);
int NuggetVPN_GetStatus(void);
void NuggetVPN_GetStats(long long *up, long long *down);

NS_ASSUME_NONNULL_END

//go:build ios

package ios

import (
	"context"
	"errors"
	"net/netip"
	"sync"

	"github.com/sagernet/sing-box/adapter"
	"github.com/sagernet/sing-box/option"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/logger"
)

var (
	tunnelMu sync.Mutex
	tunnelFD int = -1
)

func SetTunnelFD(fd int) {
	tunnelMu.Lock()
	defer tunnelMu.Unlock()
	tunnelFD = fd
}

func GetTunnelFD() int {
	tunnelMu.Lock()
	defer tunnelMu.Unlock()
	return tunnelFD
}

type Platform struct {
	networkManager adapter.NetworkManager
}

var _ adapter.PlatformInterface = (*Platform)(nil)

func NewPlatform() *Platform { return &Platform{} }

func (p *Platform) Initialize(networkManager adapter.NetworkManager) error {
	p.networkManager = networkManager
	return nil
}

func (p *Platform) UsePlatformAutoDetectInterfaceControl() bool { return false }
func (p *Platform) AutoDetectInterfaceControl(fd int) error     { return nil }

func (p *Platform) UsePlatformInterface() bool { return true }

func (p *Platform) OpenInterface(options *tun.Options, platformOptions option.TunPlatformOptions) (tun.Tun, error) {
	fd := GetTunnelFD()
	if fd <= 0 {
		return nil, errors.New("ios: no network extension tunnel descriptor set")
	}
	options.FileDescriptor = fd
	return tun.New(*options)
}

func (p *Platform) ProcessPlatformOptions(option.TunPlatformOptions) error { return nil }

func (p *Platform) UsePlatformDefaultInterfaceMonitor() bool { return false }
func (p *Platform) CreateDefaultInterfaceMonitor(log logger.Logger) tun.DefaultInterfaceMonitor {
	return nil
}

func (p *Platform) UsePlatformNetworkInterfaces() bool { return false }
func (p *Platform) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	return nil, nil
}

func (p *Platform) UnderNetworkExtension() bool              { return true }
func (p *Platform) NetworkExtensionIncludeAllNetworks() bool { return true }
func (p *Platform) ClearDNSCache()                           {}
func (p *Platform) RequestPermissionForWIFIState() error     { return nil }
func (p *Platform) UsePlatformWIFIMonitor() bool             { return false }
func (p *Platform) ReadWIFIState(context.Context) adapter.WIFIState {
	return adapter.WIFIState{}
}

func (p *Platform) UsePlatformConnectionOwnerFinder() bool { return false }
func (p *Platform) FindConnectionOwner(request *adapter.FindConnectionOwnerRequest) (*adapter.ConnectionOwner, error) {
	return nil, errors.New("not supported on iOS")
}

func (p *Platform) UsePlatformNotification() bool                             { return false }
func (p *Platform) SendNotification(*adapter.Notification) error              { return nil }
func (p *Platform) CancelNotification(string, int32) error                    { return nil }
func (p *Platform) MyInterfaceAddress() []netip.Addr                          { return nil }
func (p *Platform) UsePlatformNeighborResolver() bool                         { return false }
func (p *Platform) StartNeighborMonitor(adapter.NeighborUpdateListener) error { return nil }
func (p *Platform) CloseNeighborMonitor(adapter.NeighborUpdateListener) error { return nil }
func (p *Platform) UsePlatformShell() bool                                    { return false }
func (p *Platform) CheckPlatformShell() error                                 { return errors.New("not supported on iOS") }
func (p *Platform) OpenShellSession(*adapter.PlatformUser, string, []string, string, int32, int32) (adapter.ShellSession, error) {
	return nil, errors.New("not supported on iOS")
}
func (p *Platform) LookupUser(string) (*adapter.PlatformUser, error) { return nil, errors.New("not supported on iOS") }
func (p *Platform) LookupSFTPServer() (string, error)                { return "", errors.New("not supported on iOS") }
func (p *Platform) ReadSystemSSHHostKey() ([]byte, error)            { return nil, errors.New("not supported on iOS") }
func (p *Platform) TailscaleHostname() string                        { return "" }
func (p *Platform) UsePlatformBridge() bool                          { return false }
func (p *Platform) CreateBridge(adapter.BridgeOptions) (adapter.BridgeSession, error) {
	return nil, errors.New("not supported on iOS")
}
func (p *Platform) UsePlatformAutoRedirect() bool { return false }
func (p *Platform) CreateAutoRedirect(adapter.AutoRedirectOptions) (adapter.AutoRedirectSession, error) {
	return nil, errors.New("not supported on iOS")
}

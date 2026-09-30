//go:build android

package android

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"sync"
	"unsafe"

	"golang.org/x/sys/unix"

	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	"github.com/sagernet/sing-box/option"
	tun "github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/common/x/list"
)

// Platform gives sing-box what Android does not let it do itself: the tunnel
// comes from VpnService, sockets are kept out of it with VpnService.protect,
// and the network in use is reported by ConnectivityManager, since apps may
// not read netlink.
type Platform struct {
	networkManager adapter.NetworkManager

	access         sync.Mutex
	myTunName      string
	myTunAddress   []netip.Addr
	defaultNetwork *control.Interface
	expensive      bool
	constrained    bool
}

var _ adapter.PlatformInterface = (*Platform)(nil)

// NewPlatform returns the platform for one run of the core.
func NewPlatform() *Platform { return &Platform{} }

func (p *Platform) Initialize(networkManager adapter.NetworkManager) error {
	p.networkManager = networkManager
	return nil
}

func (p *Platform) UsePlatformAutoDetectInterfaceControl() bool { return true }

// AutoDetectInterfaceControl keeps a socket out of the tunnel, so the core's
// own connections to the servers do not loop back into it.
func (p *Platform) AutoDetectInterfaceControl(fd int) error {
	if !callBool("protect", fd) {
		// Before the tunnel is up there is nothing to loop through.
		if !callBool("vpnRunning", 0) {
			return nil
		}
		return errors.New("android: could not protect a socket")
	}
	return nil
}

func (p *Platform) UsePlatformInterface() bool { return true }

// tunRequest is what the Java side needs to build the interface.
type tunRequest struct {
	MTU            uint32   `json:"mtu"`
	Addresses      []string `json:"addresses"`
	Routes         []string `json:"routes"`
	DNS            []string `json:"dns"`
	IncludePackage []string `json:"include_package"`
	ExcludePackage []string `json:"exclude_package"`
}

func (p *Platform) OpenInterface(options *tun.Options, platformOptions option.TunPlatformOptions) (tun.Tun, error) {
	routeRanges, err := options.BuildAutoRouteRanges(true)
	if err != nil {
		return nil, err
	}
	request := tunRequest{MTU: options.MTU, IncludePackage: options.IncludePackage, ExcludePackage: options.ExcludePackage}
	for _, prefix := range append(append([]netip.Prefix{}, options.Inet4Address...), options.Inet6Address...) {
		request.Addresses = append(request.Addresses, prefix.String())
	}
	for _, prefix := range routeRanges {
		request.Routes = append(request.Routes, prefix.String())
	}
	if servers, err := options.DNSServerAddress(); err == nil {
		for _, server := range servers {
			request.DNS = append(request.DNS, server.String())
		}
	}
	data, _ := json.Marshal(request)
	answer, err := call("openTun", string(data))
	if err != nil {
		return nil, err
	}
	var result struct {
		FD    int    `json:"fd"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(answer), &result); err != nil {
		return nil, err
	}
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}
	name, err := tunnelName(result.FD)
	if err != nil {
		return nil, err
	}
	options.Name = name
	if options.InterfaceMonitor != nil {
		options.InterfaceMonitor.RegisterMyInterface(name)
	}
	// Java detached the descriptor: the core owns it now, and closing it
	// takes the interface down.
	options.FileDescriptor = result.FD
	p.access.Lock()
	p.myTunName = name
	p.myTunAddress = nil
	for _, prefix := range append(append([]netip.Prefix{}, options.Inet4Address...), options.Inet6Address...) {
		p.myTunAddress = append(p.myTunAddress, prefix.Addr())
	}
	p.access.Unlock()
	return tun.New(*options)
}

// tunnelName asks the kernel what the interface is called (tun0, usually).
func tunnelName(fd int) (string, error) {
	var request [unix.IFNAMSIZ + 64]byte
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.TUNGETIFF), uintptr(unsafe.Pointer(&request[0])))
	if errno != 0 {
		return "", fmt.Errorf("name of the tun device: %w", errno)
	}
	return unix.ByteSliceToString(request[:]), nil
}

func (p *Platform) ProcessPlatformOptions(option.TunPlatformOptions) error { return nil }

func (p *Platform) MyInterfaceAddress() []netip.Addr {
	p.access.Lock()
	defer p.access.Unlock()
	return p.myTunAddress
}

func (p *Platform) UsePlatformDefaultInterfaceMonitor() bool { return true }

func (p *Platform) CreateDefaultInterfaceMonitor(log logger.Logger) tun.DefaultInterfaceMonitor {
	return &monitor{platform: p, logger: log}
}

func (p *Platform) UsePlatformNetworkInterfaces() bool { return true }

// javaInterface is one network interface as Java reports it.
type javaInterface struct {
	Name        string   `json:"name"`
	Index       int      `json:"index"`
	MTU         int      `json:"mtu"`
	Addresses   []string `json:"addresses"`
	Type        string   `json:"type"`
	DNS         []string `json:"dns"`
	Gateways    []string `json:"gateways"`
	Metered     bool     `json:"metered"`
	Up          bool     `json:"up"`
	Loopback    bool     `json:"loopback"`
	PointToPint bool     `json:"point_to_point"`
	Multicast   bool     `json:"multicast"`
}

func (p *Platform) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	answer, err := call("networkInterfaces", "")
	if err != nil {
		return nil, err
	}
	var found []javaInterface
	if err := json.Unmarshal([]byte(answer), &found); err != nil {
		return nil, err
	}
	p.access.Lock()
	defaultIndex := -1
	if p.defaultNetwork != nil {
		defaultIndex = p.defaultNetwork.Index
	}
	expensive, constrained, myTun := p.expensive, p.constrained, p.myTunName
	p.access.Unlock()

	seen := map[string]bool{}
	var result []adapter.NetworkInterface
	for _, item := range found {
		if seen[item.Name] {
			continue
		}
		seen[item.Name] = true
		var flags net.Flags
		if item.Up {
			flags |= net.FlagUp | net.FlagRunning
		}
		if item.Loopback {
			flags |= net.FlagLoopback
		}
		if item.PointToPint {
			flags |= net.FlagPointToPoint
		}
		if item.Multicast {
			flags |= net.FlagMulticast
		}
		var addresses []netip.Prefix
		for _, address := range item.Addresses {
			if prefix, err := netip.ParsePrefix(address); err == nil {
				addresses = append(addresses, prefix)
			}
		}
		var gateways []netip.Addr
		for _, gateway := range item.Gateways {
			if address, err := netip.ParseAddr(gateway); err == nil {
				gateways = append(gateways, address.Unmap().WithZone(""))
			}
		}
		kind, ok := C.StringToInterfaceType[item.Type]
		if !ok {
			kind = C.InterfaceTypeOther
		}
		isDefault := item.Name != myTun && item.Index == defaultIndex
		result = append(result, adapter.NetworkInterface{
			Interface: control.Interface{
				Index: item.Index, MTU: item.MTU, Name: item.Name, Addresses: addresses, Flags: flags,
			},
			Type:        kind,
			DNSServers:  item.DNS,
			Gateways:    gateways,
			Expensive:   item.Metered || isDefault && expensive,
			Constrained: isDefault && constrained,
		})
	}
	return result, nil
}

func (p *Platform) UnderNetworkExtension() bool              { return false }
func (p *Platform) NetworkExtensionIncludeAllNetworks() bool { return false }
func (p *Platform) ClearDNSCache()                           {}
func (p *Platform) RequestPermissionForWIFIState() error     { return nil }
func (p *Platform) UsePlatformWIFIMonitor() bool             { return false }
func (p *Platform) ReadWIFIState(context.Context) adapter.WIFIState {
	return adapter.WIFIState{}
}

func (p *Platform) UsePlatformConnectionOwnerFinder() bool { return true }

// FindConnectionOwner names the app behind a connection, for the
// connections screen and for per-app rules.
func (p *Platform) FindConnectionOwner(request *adapter.FindConnectionOwnerRequest) (*adapter.ConnectionOwner, error) {
	data, _ := json.Marshal(map[string]any{
		"protocol": request.IpProtocol, "source": request.SourceAddress, "source_port": request.SourcePort,
		"destination": request.DestinationAddress, "destination_port": request.DestinationPort,
	})
	answer, err := call("findConnectionOwner", string(data))
	if err != nil {
		return nil, err
	}
	var owner struct {
		UID      int32    `json:"uid"`
		Packages []string `json:"packages"`
		Error    string   `json:"error"`
	}
	if err := json.Unmarshal([]byte(answer), &owner); err != nil {
		return nil, err
	}
	if owner.Error != "" {
		return nil, errors.New(owner.Error)
	}
	return &adapter.ConnectionOwner{UserId: owner.UID, PackageNames: owner.Packages}, nil
}

func (p *Platform) UsePlatformNotification() bool                             { return false }
func (p *Platform) SendNotification(*adapter.Notification) error              { return nil }
func (p *Platform) CancelNotification(string, int32) error                    { return nil }
func (p *Platform) UsePlatformNeighborResolver() bool                         { return false }
func (p *Platform) StartNeighborMonitor(adapter.NeighborUpdateListener) error { return nil }
func (p *Platform) CloseNeighborMonitor(adapter.NeighborUpdateListener) error { return nil }
func (p *Platform) UsePlatformShell() bool                                    { return false }
func (p *Platform) CheckPlatformShell() error                                 { return errUnsupported }
func (p *Platform) OpenShellSession(*adapter.PlatformUser, string, []string, string, int32, int32) (adapter.ShellSession, error) {
	return nil, errUnsupported
}
func (p *Platform) LookupUser(string) (*adapter.PlatformUser, error) { return nil, errUnsupported }
func (p *Platform) LookupSFTPServer() (string, error)                { return "", errUnsupported }
func (p *Platform) ReadSystemSSHHostKey() ([]byte, error)            { return nil, errUnsupported }
func (p *Platform) TailscaleHostname() string                        { return "" }
func (p *Platform) UsePlatformBridge() bool                          { return false }
func (p *Platform) CreateBridge(adapter.BridgeOptions) (adapter.BridgeSession, error) {
	return nil, errUnsupported
}
func (p *Platform) UsePlatformAutoRedirect() bool { return false }
func (p *Platform) CreateAutoRedirect(adapter.AutoRedirectOptions) (adapter.AutoRedirectSession, error) {
	return nil, errUnsupported
}

var errUnsupported = errors.New("not supported on Android")

// monitor follows the network Android routes through, as ConnectivityManager
// reports it.
type monitor struct {
	platform    *Platform
	logger      logger.Logger
	access      sync.Mutex
	callbacks   list.List[tun.DefaultInterfaceUpdateCallback]
	mine        []string
	initialized bool
}

var _ tun.DefaultInterfaceMonitor = (*monitor)(nil)

func (m *monitor) Start() error {
	callbacksMu.Lock()
	onDefaultNetwork = m.update
	callbacksMu.Unlock()
	if _, err := call("startNetworkMonitor", ""); err != nil {
		return err
	}
	return nil
}

func (m *monitor) Close() error {
	callbacksMu.Lock()
	onDefaultNetwork = nil
	callbacksMu.Unlock()
	_, _ = call("stopNetworkMonitor", "")
	return nil
}

func (m *monitor) DefaultInterface() *control.Interface {
	m.platform.access.Lock()
	defer m.platform.access.Unlock()
	return m.platform.defaultNetwork
}

func (m *monitor) OverrideAndroidVPN() bool { return false }
func (m *monitor) AndroidVPNEnabled() bool  { return false }

func (m *monitor) RegisterCallback(callback tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	m.access.Lock()
	defer m.access.Unlock()
	return m.callbacks.PushBack(callback)
}

func (m *monitor) UnregisterCallback(element *list.Element[tun.DefaultInterfaceUpdateCallback]) {
	m.access.Lock()
	defer m.access.Unlock()
	m.callbacks.Remove(element)
}

func (m *monitor) RegisterMyInterface(name string) {
	m.access.Lock()
	defer m.access.Unlock()
	m.mine = append(m.mine, name)
}

func (m *monitor) MyInterfaces() []string {
	m.access.Lock()
	defer m.access.Unlock()
	return append([]string(nil), m.mine...)
}

// update takes a new default network from Java; index -1 means none.
func (m *monitor) update(name string, index int, expensive, constrained bool) {
	p := m.platform
	p.access.Lock()
	p.expensive, p.constrained = expensive, constrained
	p.access.Unlock()
	if p.networkManager != nil {
		if err := p.networkManager.UpdateInterfaces(); err != nil {
			m.logger.Error("update interfaces: ", err)
		}
	}

	var next *control.Interface
	if index >= 0 && p.networkManager != nil {
		found, err := p.networkManager.InterfaceFinder().ByIndex(index)
		if err != nil {
			m.logger.Error("find interface ", name, ": ", err)
			return
		}
		next = found
	}
	p.access.Lock()
	previous := p.defaultNetwork
	p.defaultNetwork = next
	p.access.Unlock()

	m.access.Lock()
	unchanged := m.initialized && previous != nil && next != nil && previous.Name == next.Name && previous.Index == next.Index
	m.initialized = true
	callbacks := m.callbacks.Array()
	m.access.Unlock()
	if unchanged {
		return
	}
	for _, callback := range callbacks {
		callback(next, 0)
	}
}

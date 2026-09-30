//go:build with_usbip && (linux || (darwin && cgo) || windows)

package usbip

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	boxService "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/service"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/common/dialer"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	"github.com/sagernet/sing-usbip"
	E "github.com/sagernet/sing/common/exceptions"
)

type ClientService struct {
	boxService.Adapter
	ctx    context.Context
	logger log.ContextLogger
	inner  *usbip.ClientService
	detour string
}

func NewClientService(ctx context.Context, logger log.ContextLogger, tag string, options option.USBIPClientServiceOptions) (adapter.Service, error) {
	serviceDialer, err := dialer.NewWithOptions(dialer.Options{
		Context: ctx,
		Options: option.DialerOptions{
			Detour: options.Detour,
		},
		RemoteIsDomain: true,
	})
	if err != nil {
		return nil, E.Cause(err, "create dialer")
	}
	inner, err := usbip.NewClientService(ctx, usbip.ClientOptions{
		Logger:        logger,
		Dialer:        serviceDialer,
		ServerAddress: options.ServerOptions.Build(),
		Devices:       toDeviceMatches(options.Devices),
	})
	if err != nil {
		return nil, err
	}
	return &ClientService{
		Adapter: boxService.NewAdapter(C.TypeUSBIPClient, tag),
		ctx:     ctx,
		logger:  logger,
		inner:   inner,
		detour:  options.Detour,
	}, nil
}

func (s *ClientService) Start(stage adapter.StartStage) error {
	if stage != adapter.StartStateStart {
		return nil
	}
	return s.inner.Start()
}

func (s *ClientService) Close() error {
	return s.inner.Close()
}

func (s *ClientService) References() []string {
	if s.detour == "" {
		return nil
	}
	return []string{s.detour}
}

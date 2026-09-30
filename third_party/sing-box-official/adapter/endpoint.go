package adapter

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
)

type Endpoint interface {
	Lifecycle
	Type() string
	Tag() string
	Outbound
}

type OnDemandEndpoint interface {
	Endpoint
	OnDemand() bool
	SetKeepIdleConnections(keep bool)
}

type EndpointRegistry interface {
	option.EndpointOptionsRegistry
	Create(ctx context.Context, router Router, logger log.ContextLogger, tag string, endpointType string, options any) (Endpoint, error)
}

type EndpointManager interface {
	Lifecycle
	Endpoints() []Endpoint
	Get(tag string) (Endpoint, bool)
	Remove(tag string) error
	Create(ctx context.Context, router Router, logger log.ContextLogger, tag string, endpointType string, options any) error
}

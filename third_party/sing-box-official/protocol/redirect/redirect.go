package redirect

import (
	"context"
	"net"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/inbound"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/common/listener"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/common/redir"
	C "github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/constant"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	M "github.com/sagernet/sing/common/metadata"
	N "github.com/sagernet/sing/common/network"
)

func RegisterRedirect(registry *inbound.Registry) {
	inbound.Register[option.RedirectInboundOptions](registry, C.TypeRedirect, NewRedirect)
}

type Redirect struct {
	inbound.Adapter
	router   adapter.Router
	logger   log.ContextLogger
	listener *listener.Listener
}

func NewRedirect(ctx context.Context, router adapter.Router, logger log.ContextLogger, tag string, options option.RedirectInboundOptions) (adapter.Inbound, error) {
	redirect := &Redirect{
		Adapter: inbound.NewAdapter(C.TypeRedirect, tag),
		router:  router,
		logger:  logger,
	}
	redirect.listener = listener.New(listener.Options{
		Context:           ctx,
		Logger:            logger,
		Network:           []string{N.NetworkTCP},
		Listen:            options.ListenOptions,
		ConnectionHandler: redirect,
	})
	return redirect, nil
}

func (h *Redirect) Start(stage adapter.StartStage) error {
	if stage != adapter.StartStateStart {
		return nil
	}
	return h.listener.Start()
}

func (h *Redirect) Close() error {
	return h.listener.Close()
}

func (h *Redirect) NewConnection(ctx context.Context, conn net.Conn, metadata adapter.InboundContext, onClose N.CloseHandlerFunc) {
	destination, err := redir.GetOriginalDestination(conn)
	if err != nil {
		conn.Close()
		h.logger.ErrorContext(ctx, "process connection from ", conn.RemoteAddr(), ": get redirect destination: ", err)
		return
	}
	metadata.Inbound = h.Tag()
	metadata.InboundType = h.Type()
	metadata.Destination = M.SocksaddrFromNetIP(destination)
	h.logger.InfoContext(ctx, "inbound connection to ", metadata.Destination)
	h.router.RouteConnectionEx(ctx, conn, metadata, onClose)
}

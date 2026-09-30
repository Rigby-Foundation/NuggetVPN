//go:build !with_clash_api

package include

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/experimental"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/log"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	E "github.com/sagernet/sing/common/exceptions"
)

func init() {
	experimental.RegisterClashServerConstructor(func(ctx context.Context, logFactory log.ObservableFactory, options option.ClashAPIOptions) (adapter.LifecycleService, error) {
		return nil, E.New(`clash api is not included in this build, rebuild with -tags with_clash_api`)
	})
}

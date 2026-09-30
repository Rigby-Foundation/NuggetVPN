//go:build !ios

package rule

import (
	"context"

	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/option"
	"github.com/sagernet/sing/common/logger"
)

func mmapRuleSet(ctx context.Context, logger logger.Logger, tag string, ruleSet option.PlainRuleSetCompat) option.PlainRuleSetCompat {
	return ruleSet
}

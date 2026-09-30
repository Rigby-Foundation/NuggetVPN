package rule

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
)

var _ RuleItem = (*QueryDNSSECItem)(nil)

type QueryDNSSECItem struct{}

func NewQueryDNSSECItem() *QueryDNSSECItem {
	return &QueryDNSSECItem{}
}

func (r *QueryDNSSECItem) Match(metadata *adapter.InboundContext) bool {
	return metadata.QueryDNSSEC
}

func (r *QueryDNSSECItem) String() string {
	return "query_dnssec=true"
}

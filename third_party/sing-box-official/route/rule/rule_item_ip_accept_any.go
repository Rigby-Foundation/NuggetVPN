package rule

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter"
)

var _ RuleItem = (*IPAcceptAnyItem)(nil)

type IPAcceptAnyItem struct{}

func NewIPAcceptAnyItem() *IPAcceptAnyItem {
	return &IPAcceptAnyItem{}
}

func (r *IPAcceptAnyItem) Match(metadata *adapter.InboundContext) bool {
	if metadata.DestinationAddressMatchFromResponse {
		return len(metadata.DNSResponseAddressesForMatch()) > 0
	}
	return len(metadata.DestinationAddresses) > 0
}

func (r *IPAcceptAnyItem) String() string {
	return "ip_accept_any=true"
}

// Package geodat reads V2Ray/Xray geoip.dat and geosite.dat files — the
// format Happ and most Xray clients ship — and turns entries from them into
// sing-box rule-sets.
//
// The core cannot read these files: its own geoip/geosite databases were
// removed in sing-box 1.12 in favour of rule-sets (see the TodayCore docs,
// configuration/route/geoip.md). So a code a rule asks for is looked up here
// and written out as a local source rule-set.
//
// The files are protobuf. The schema is small and stable, so it is decoded by
// hand with protowire rather than by generating code for it:
//
//	GeoIPList   { repeated GeoIP   entry = 1 }
//	GeoIP       { string country_code = 1; repeated CIDR cidr = 2; bool reverse_match = 3 }
//	CIDR        { bytes ip = 1; uint32 prefix = 2 }
//	GeoSiteList { repeated GeoSite entry = 1 }
//	GeoSite     { string country_code = 1; repeated Domain domain = 2 }
//	Domain      { Type type = 1; string value = 2; repeated Attribute attribute = 3 }
//	Attribute   { string key = 1; ... }
//	Type        { Plain = 0; Regex = 1; RootDomain = 2; Full = 3 }
package geodat

import (
	"errors"
	"fmt"
	"net/netip"
	"sort"
	"strings"

	"google.golang.org/protobuf/encoding/protowire"
)

// Kind is which of the two files a code belongs to.
type Kind string

const (
	GeoIP   Kind = "geoip"
	GeoSite Kind = "geosite"
)

// Domain rule types in geosite.dat.
const (
	domainPlain  = 0 // substring: a keyword
	domainRegex  = 1
	domainSuffix = 2 // "RootDomain": the domain and everything under it
	domainFull   = 3
)

// ErrNotDat means the bytes did not decode as the expected list.
var ErrNotDat = errors.New("not a geoip.dat or geosite.dat file")

// Sites is one geosite code, split the way a sing-box rule wants it.
type Sites struct {
	Domain  []string
	Suffix  []string
	Keyword []string
	Regex   []string
}

// Empty reports whether nothing matched.
func (s Sites) Empty() bool {
	return len(s.Domain)+len(s.Suffix)+len(s.Keyword)+len(s.Regex) == 0
}

// Query is a code as written in a rule: "google", or "google@cn" to keep
// only the entries carrying the cn attribute. Codes are case-insensitive in
// the files, so they are compared lowercased.
type Query struct {
	Code      string
	Attribute string
}

// ParseQuery splits "code@attribute".
func ParseQuery(value string) Query {
	code, attribute, _ := strings.Cut(strings.ToLower(strings.TrimSpace(value)), "@")
	return Query{Code: code, Attribute: attribute}
}

// entries walks the top-level repeated field 1 of either list, handing each
// entry's bytes to visit.
func entries(data []byte, visit func(entry []byte) error) error {
	seen := 0
	for len(data) > 0 {
		number, kind, n := protowire.ConsumeTag(data)
		if n < 0 {
			return ErrNotDat
		}
		data = data[n:]
		if number == 1 && kind == protowire.BytesType {
			entry, m := protowire.ConsumeBytes(data)
			if m < 0 {
				return ErrNotDat
			}
			data = data[m:]
			seen++
			if err := visit(entry); err != nil {
				return err
			}
			continue
		}
		m := protowire.ConsumeFieldValue(number, kind, data)
		if m < 0 {
			return ErrNotDat
		}
		data = data[m:]
	}
	if seen == 0 {
		return ErrNotDat
	}
	return nil
}

// fields walks one message, calling visit for each field.
func fields(data []byte, visit func(number protowire.Number, kind protowire.Type, value []byte, varint uint64)) error {
	for len(data) > 0 {
		number, kind, n := protowire.ConsumeTag(data)
		if n < 0 {
			return ErrNotDat
		}
		data = data[n:]
		switch kind {
		case protowire.BytesType:
			value, m := protowire.ConsumeBytes(data)
			if m < 0 {
				return ErrNotDat
			}
			visit(number, kind, value, 0)
			data = data[m:]
		case protowire.VarintType:
			value, m := protowire.ConsumeVarint(data)
			if m < 0 {
				return ErrNotDat
			}
			visit(number, kind, nil, value)
			data = data[m:]
		default:
			m := protowire.ConsumeFieldValue(number, kind, data)
			if m < 0 {
				return ErrNotDat
			}
			data = data[m:]
		}
	}
	return nil
}

// codeOf reads an entry's country_code without decoding the rest of it.
func codeOf(entry []byte) (string, error) {
	var code string
	err := fields(entry, func(number protowire.Number, kind protowire.Type, value []byte, _ uint64) {
		if number == 1 && kind == protowire.BytesType {
			code = strings.ToLower(string(value))
		}
	})
	return code, err
}

// Codes lists every code in a file, sorted, for suggestions in the UI.
func Codes(data []byte) ([]string, error) {
	var codes []string
	err := entries(data, func(entry []byte) error {
		code, err := codeOf(entry)
		if err != nil {
			return err
		}
		if code != "" {
			codes = append(codes, code)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(codes)
	return codes, nil
}

// DetectKind tells a geoip.dat from a geosite.dat by what its first entry
// holds: CIDRs carry raw address bytes of 4 or 16, domains a nested message.
func DetectKind(data []byte) (Kind, error) {
	var detected Kind
	err := entries(data, func(entry []byte) error {
		if detected != "" {
			return nil
		}
		return fields(entry, func(number protowire.Number, kind protowire.Type, value []byte, _ uint64) {
			if detected != "" || number != 2 || kind != protowire.BytesType {
				return
			}
			var ipBytes int
			_ = fields(value, func(n protowire.Number, k protowire.Type, v []byte, _ uint64) {
				if n == 1 && k == protowire.BytesType {
					ipBytes = len(v)
				}
			})
			if ipBytes == 4 || ipBytes == 16 {
				detected = GeoIP
			} else {
				detected = GeoSite
			}
		})
	})
	if err != nil {
		return "", err
	}
	if detected == "" {
		return "", fmt.Errorf("%w: no entries with data", ErrNotDat)
	}
	return detected, nil
}

// LookupIPs collects the prefixes for each requested code in one pass. A code
// missing from the file is absent from the result.
func LookupIPs(data []byte, codes []string) (map[string][]netip.Prefix, error) {
	want := map[string]bool{}
	for _, code := range codes {
		want[strings.ToLower(code)] = true
	}
	found := map[string][]netip.Prefix{}

	err := entries(data, func(entry []byte) error {
		code, err := codeOf(entry)
		if err != nil || !want[code] {
			return err
		}
		prefixes := []netip.Prefix{}
		err = fields(entry, func(number protowire.Number, kind protowire.Type, value []byte, _ uint64) {
			if number != 2 || kind != protowire.BytesType {
				return
			}
			var ip []byte
			var bits uint64
			_ = fields(value, func(n protowire.Number, k protowire.Type, v []byte, varint uint64) {
				switch {
				case n == 1 && k == protowire.BytesType:
					ip = v
				case n == 2 && k == protowire.VarintType:
					bits = varint
				}
			})
			address, ok := netip.AddrFromSlice(ip)
			if !ok || int(bits) > address.BitLen() {
				return
			}
			if prefix, err := address.Prefix(int(bits)); err == nil {
				prefixes = append(prefixes, prefix)
			}
		})
		found[code] = prefixes
		return err
	})
	return found, err
}

// LookupSites collects the domains for each requested query in one pass,
// honouring an @attribute filter. A code missing from the file is absent
// from the result.
func LookupSites(data []byte, queries []Query) (map[Query]Sites, error) {
	byCode := map[string][]Query{}
	for _, query := range queries {
		byCode[query.Code] = append(byCode[query.Code], query)
	}
	found := map[Query]Sites{}

	err := entries(data, func(entry []byte) error {
		code, err := codeOf(entry)
		if err != nil {
			return err
		}
		wanted := byCode[code]
		if len(wanted) == 0 {
			return nil
		}
		results := make([]Sites, len(wanted))
		err = fields(entry, func(number protowire.Number, kind protowire.Type, value []byte, _ uint64) {
			if number != 2 || kind != protowire.BytesType {
				return
			}
			var domainType uint64
			var domain string
			attributes := map[string]bool{}
			_ = fields(value, func(n protowire.Number, k protowire.Type, v []byte, varint uint64) {
				switch {
				case n == 1 && k == protowire.VarintType:
					domainType = varint
				case n == 2 && k == protowire.BytesType:
					domain = string(v)
				case n == 3 && k == protowire.BytesType:
					_ = fields(v, func(an protowire.Number, ak protowire.Type, av []byte, _ uint64) {
						if an == 1 && ak == protowire.BytesType {
							attributes[strings.ToLower(string(av))] = true
						}
					})
				}
			})
			if domain == "" {
				return
			}
			for i, query := range wanted {
				if query.Attribute != "" && !attributes[query.Attribute] {
					continue
				}
				switch domainType {
				case domainPlain:
					results[i].Keyword = append(results[i].Keyword, domain)
				case domainRegex:
					results[i].Regex = append(results[i].Regex, domain)
				case domainSuffix:
					results[i].Suffix = append(results[i].Suffix, domain)
				case domainFull:
					results[i].Domain = append(results[i].Domain, domain)
				}
			}
		})
		for i, query := range wanted {
			found[query] = results[i]
		}
		return err
	})
	return found, err
}

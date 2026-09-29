package geodat

import (
	"errors"
	"net/netip"
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

// Fixture builders, following the schema in the package doc.

func message(build func(b []byte) []byte) []byte { return build(nil) }

func bytesField(b []byte, number protowire.Number, value []byte) []byte {
	b = protowire.AppendTag(b, number, protowire.BytesType)
	return protowire.AppendBytes(b, value)
}

func varintField(b []byte, number protowire.Number, value uint64) []byte {
	b = protowire.AppendTag(b, number, protowire.VarintType)
	return protowire.AppendVarint(b, value)
}

func geoIPList(entries map[string][]string) []byte {
	var list []byte
	for code, cidrs := range entries {
		entry := bytesField(nil, 1, []byte(code))
		for _, cidr := range cidrs {
			prefix := netip.MustParsePrefix(cidr)
			one := message(func(b []byte) []byte {
				b = bytesField(b, 1, prefix.Addr().AsSlice())
				return varintField(b, 2, uint64(prefix.Bits()))
			})
			entry = bytesField(entry, 2, one)
		}
		list = bytesField(list, 1, entry)
	}
	return list
}

type site struct {
	kind       uint64
	value      string
	attributes []string
}

func geoSiteList(entries map[string][]site) []byte {
	var list []byte
	for code, sites := range entries {
		entry := bytesField(nil, 1, []byte(code))
		for _, s := range sites {
			domain := message(func(b []byte) []byte {
				b = varintField(b, 1, s.kind)
				b = bytesField(b, 2, []byte(s.value))
				for _, attribute := range s.attributes {
					b = bytesField(b, 3, bytesField(nil, 1, []byte(attribute)))
				}
				return b
			})
			entry = bytesField(entry, 2, domain)
		}
		list = bytesField(list, 1, entry)
	}
	return list
}

func TestGeoIP(t *testing.T) {
	data := geoIPList(map[string][]string{
		"RU": {"5.8.0.0/19", "2a00:1fa0::/29"},
		"US": {"3.0.0.0/9"},
	})

	kind, err := DetectKind(data)
	if err != nil || kind != GeoIP {
		t.Fatalf("detected %q, %v", kind, err)
	}
	codes, _ := Codes(data)
	if len(codes) != 2 || codes[0] != "ru" || codes[1] != "us" {
		t.Errorf("codes = %v; they should be lowercased and sorted", codes)
	}

	found, err := LookupIPs(data, []string{"ru", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if got := found["ru"]; len(got) != 2 || got[0].String() != "5.8.0.0/19" || got[1].String() != "2a00:1fa0::/29" {
		t.Errorf("ru = %v", got)
	}
	if _, ok := found["missing"]; ok {
		t.Error("a code not in the file should be absent, not empty")
	}
}

func TestGeoSiteTypesAndAttributes(t *testing.T) {
	data := geoSiteList(map[string][]site{
		"google": {
			{domainSuffix, "google.com", nil},
			{domainFull, "www.google.cn", []string{"cn"}},
			{domainPlain, "googleapis", nil},
			{domainRegex, `^g\d+\.example$`, []string{"cn"}},
		},
	})

	kind, err := DetectKind(data)
	if err != nil || kind != GeoSite {
		t.Fatalf("detected %q, %v", kind, err)
	}

	all, cn := ParseQuery("GOOGLE"), ParseQuery("google@cn")
	found, err := LookupSites(data, []Query{all, cn})
	if err != nil {
		t.Fatal(err)
	}
	everything := found[all]
	if len(everything.Suffix) != 1 || len(everything.Domain) != 1 || len(everything.Keyword) != 1 || len(everything.Regex) != 1 {
		t.Errorf("each domain type should land in its own list: %+v", everything)
	}
	filtered := found[cn]
	if len(filtered.Domain) != 1 || len(filtered.Regex) != 1 || len(filtered.Suffix) != 0 || len(filtered.Keyword) != 0 {
		t.Errorf("@cn should keep only entries carrying that attribute: %+v", filtered)
	}
}

func TestRejectsOtherFiles(t *testing.T) {
	for name, data := range map[string][]byte{
		"empty":     nil,
		"text":      []byte("this is not protobuf at all, just a text file\n"),
		"truncated": geoIPList(map[string][]string{"ru": {"5.8.0.0/19"}})[:7],
	} {
		if _, err := DetectKind(data); !errors.Is(err, ErrNotDat) {
			t.Errorf("%s: got %v, want ErrNotDat", name, err)
		}
	}
}

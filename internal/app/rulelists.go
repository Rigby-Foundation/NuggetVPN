package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/idna"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/Rigby-Foundation/NuggetVPN/internal/sbconfig"
	"github.com/Rigby-Foundation/NuggetVPN/internal/storage"
)

// ---------------------------------------------------------------------------
// Rule lists from URLs
// ---------------------------------------------------------------------------
//
// A rule list is a maintained list of sites or addresses — blocked in some
// country, ad servers, a game's servers — published at a URL. Lists in the
// core's own formats (.srs, .json) are handed to it to download and refresh.
// Everything else is the plain formats these lists are usually published in,
// which the core cannot read, so the app downloads them, converts them, and
// refreshes them once they are a day old.

const (
	// maxRuleListSize bounds a list download. The largest common lists are a
	// few megabytes.
	maxRuleListSize = 64 << 20
	// ruleListMaxAge is when a list is downloaded again at connect time.
	ruleListMaxAge = 24 * time.Hour
)

// RuleListStatus describes one list for the UI.
type RuleListStatus struct {
	URL string `json:"url"`
	// Native lists are downloaded by the core, which reports nothing back;
	// their entries are unknown here.
	Native    bool   `json:"native"`
	Entries   int    `json:"entries"`
	UpdatedAt int64  `json:"updated_at"`
	Error     string `json:"error,omitempty"`
}

// ruleListDir holds the downloaded lists, which outlive a connection.
func ruleListDir() string { return filepath.Join(storage.DataDir(), "lists") }

func ruleListCache(address string) string {
	return filepath.Join(ruleListDir(), sbconfig.ListTag(address)+".txt")
}

// ruleListURLs returns every list URL the routing uses, in order.
func ruleListURLs(settings models.AppSettings) []string {
	var urls []string
	seen := map[string]bool{}
	for _, rule := range settings.UsableRules() {
		for _, matcher := range rule.Matchers() {
			if matcher.Kind != models.SourceRuleSet {
				continue
			}
			for _, address := range matcher.Values {
				if !seen[address] {
					seen[address] = true
					urls = append(urls, address)
				}
			}
		}
	}
	return urls
}

// GetRuleLists reports on the lists the routing uses, without downloading.
func (a *App) GetRuleLists() []RuleListStatus {
	_, settings := a.snapshot()
	statuses := []RuleListStatus{}
	for _, address := range ruleListURLs(settings) {
		statuses = append(statuses, readRuleListStatus(address))
	}
	return statuses
}

// UpdateRuleLists downloads every list the routing uses now, and restarts a
// running tunnel so they take effect.
func (a *App) UpdateRuleLists() ([]RuleListStatus, error) {
	_, settings := a.snapshot()
	_, warnings := a.prepareRuleLists(settings, true)
	for _, warning := range warnings {
		a.appendLog("WARN " + warning)
	}
	if err := a.reapplyRouting(); err != nil {
		return a.GetRuleLists(), err
	}
	return a.GetRuleLists(), nil
}

func readRuleListStatus(address string) RuleListStatus {
	status := RuleListStatus{URL: address}
	if _, native := sbconfig.NativeListFormat(address); native {
		status.Native = true
		return status
	}
	cache := ruleListCache(address)
	stat, err := os.Stat(cache)
	if err != nil {
		return status
	}
	status.UpdatedAt = stat.ModTime().Unix()
	if data, err := os.ReadFile(cache); err == nil {
		status.Entries = parseRuleList(data).count()
	}
	return status
}

// prepareRuleLists makes sure every plain list the routing uses is on disk
// and converted, downloading the ones that are missing or old (or all of
// them, with force). A list that cannot be downloaded falls back to the copy
// already on disk; one that was never downloaded is left out, with a
// warning, and the rest of the routing still works.
func (a *App) prepareRuleLists(settings models.AppSettings, force bool) (map[string]sbconfig.RuleList, []string) {
	lists := map[string]sbconfig.RuleList{}
	var warnings []string

	for _, address := range ruleListURLs(settings) {
		if _, native := sbconfig.NativeListFormat(address); native {
			continue
		}
		cache := ruleListCache(address)
		stat, statErr := os.Stat(cache)
		if force || statErr != nil || time.Since(stat.ModTime()) > ruleListMaxAge {
			if err := a.downloadRuleList(address, cache); err != nil {
				if statErr != nil {
					warnings = append(warnings, fmt.Sprintf("Rule list %s could not be downloaded (%v); rules using it are skipped.", address, err))
					continue
				}
				warnings = append(warnings, fmt.Sprintf("Rule list %s could not be updated (%v); using the copy from %s.", address, err, stat.ModTime().Format("2006-01-02")))
			}
		}

		data, err := os.ReadFile(cache)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("Rule list %s could not be read: %v", address, err))
			continue
		}
		entries := parseRuleList(data)
		if entries.count() == 0 {
			warnings = append(warnings, fmt.Sprintf("Rule list %s has nothing this app recognises as a domain or an address; rules using it are skipped.", address))
			continue
		}
		list, err := writeRuleList(address, entries)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("Rule list %s could not be converted: %v", address, err))
			continue
		}
		lists[address] = list
	}
	return lists, warnings
}

func (a *App) downloadRuleList(address, target string) error {
	client := &http.Client{Timeout: time.Minute}
	request, err := http.NewRequestWithContext(a.context(), http.MethodGet, address, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("the server answered %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxRuleListSize+1))
	if err != nil {
		return err
	}
	if len(data) > maxRuleListSize {
		return errors.New("the list is larger than 64 MB")
	}
	if parseRuleList(data).count() == 0 {
		// An error page or a login wall, most likely; keep the old copy.
		return errors.New("the download is not a list of domains or addresses")
	}

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	temporary := target + ".part"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

// writeRuleList writes a list as the core's source rule-sets: one with
// everything, and one with only the domains, for DNS rules.
func writeRuleList(address string, entries ruleListEntries) (sbconfig.RuleList, error) {
	dir := storage.RuleSetDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return sbconfig.RuleList{}, err
	}
	tag := sbconfig.ListTag(address)
	write := func(name string, rules []map[string]any) (string, error) {
		target := filepath.Join(dir, name+".json")
		body, err := json.Marshal(map[string]any{"version": 3, "rules": rules})
		if err != nil {
			return "", err
		}
		return target, os.WriteFile(target, body, 0o644)
	}

	domains := entries.domainRule()
	all := []map[string]any{}
	if len(domains) > 0 {
		all = append(all, domains)
	}
	if len(entries.cidr) > 0 {
		// A separate rule: in one rule, a domain field and an address field
		// would both have to match.
		all = append(all, map[string]any{"ip_cidr": entries.cidr})
	}

	list := sbconfig.RuleList{}
	var err error
	if list.Path, err = write(tag, all); err != nil {
		return list, err
	}
	if len(domains) > 0 {
		if list.DomainsPath, err = write(tag+"-domains", []map[string]any{domains}); err != nil {
			return list, err
		}
	}
	return list, nil
}

// byteOrderMark starts some lists saved by Windows editors.
const byteOrderMark = string(rune(0xFEFF))

// ruleListEntries is a parsed list.
type ruleListEntries struct {
	domain, suffix, keyword, regex, cidr []string
}

func (e ruleListEntries) count() int {
	return len(e.domain) + len(e.suffix) + len(e.keyword) + len(e.regex) + len(e.cidr)
}

func (e ruleListEntries) domainRule() map[string]any {
	rule := map[string]any{}
	for field, values := range map[string][]string{
		"domain":         e.domain,
		"domain_suffix":  e.suffix,
		"domain_keyword": e.keyword,
		"domain_regex":   e.regex,
	} {
		if len(values) > 0 {
			rule[field] = values
		}
	}
	return rule
}

// parseRuleList reads the plain formats rule lists are published in, one
// entry per line:
//
//	example.com            the site and everything under it
//	*.example.com          .example.com   +.example.com   everything under it
//	1.2.3.0/24   1.2.3.4   addresses
//	0.0.0.0 example.com    hosts-file lines
//	DOMAIN-SUFFIX,example.com   DOMAIN,…   DOMAIN-KEYWORD,…   IP-CIDR,…
//	                       Clash rule lines, also inside a YAML "payload:" list
//	full:…  domain:…  keyword:…  regexp:…
//	                       V2Ray domain-list lines
//
// Comments (#, //, !, ;) and anything unrecognised are skipped.
func parseRuleList(data []byte) ruleListEntries {
	var entries ruleListEntries
	seen := map[string]bool{}
	add := func(list *[]string, kind, value string) {
		key := kind + "\x00" + value
		if value == "" || seen[key] {
			return
		}
		seen[key] = true
		*list = append(*list, value)
	}
	addDomain := func(value string) {
		value = asciiHost(strings.TrimSuffix(strings.ToLower(value), "."))
		switch {
		case strings.HasPrefix(value, "*."), strings.HasPrefix(value, "+."):
			if host := value[2:]; looksLikeHost(host) {
				add(&entries.suffix, "suffix", "."+host)
			}
		case strings.HasPrefix(value, "."):
			if looksLikeHost(value[1:]) {
				add(&entries.suffix, "suffix", value)
			}
		case looksLikeHost(value):
			// The site and everything under it, as the domain rules do.
			add(&entries.domain, "domain", value)
			add(&entries.suffix, "suffix", "."+value)
		}
	}
	addCIDR := func(value string) bool {
		if prefix, err := netip.ParsePrefix(value); err == nil {
			add(&entries.cidr, "cidr", prefix.Masked().String())
			return true
		}
		if address, err := netip.ParseAddr(value); err == nil {
			add(&entries.cidr, "cidr", netip.PrefixFrom(address, address.BitLen()).String())
			return true
		}
		return false
	}

	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(strings.TrimPrefix(raw, byteOrderMark))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") ||
			strings.HasPrefix(line, "!") || strings.HasPrefix(line, ";") || line == "payload:" {
			continue
		}
		// A YAML list item: - 'DOMAIN-SUFFIX,example.com'
		if rest, ok := strings.CutPrefix(line, "- "); ok {
			line = strings.Trim(strings.TrimSpace(rest), `'"`)
		}
		// A trailing comment.
		if index := strings.Index(line, " #"); index > 0 {
			line = strings.TrimSpace(line[:index])
		}

		// Clash rules: TYPE,value[,options]
		if kind, rest, ok := strings.Cut(line, ","); ok {
			value, _, _ := strings.Cut(rest, ",")
			value = strings.TrimSpace(value)
			switch strings.ToUpper(strings.TrimSpace(kind)) {
			case "DOMAIN":
				if host := asciiHost(strings.ToLower(value)); looksLikeHost(host) {
					add(&entries.domain, "domain", host)
				}
			case "DOMAIN-SUFFIX":
				addDomain(value)
			case "DOMAIN-KEYWORD":
				add(&entries.keyword, "keyword", strings.ToLower(value))
			case "DOMAIN-REGEX":
				if _, err := regexp.Compile(value); err == nil {
					add(&entries.regex, "regex", value)
				}
			case "IP-CIDR", "IP-CIDR6":
				addCIDR(value)
			}
			continue
		}

		// V2Ray domain-list prefixes.
		if kind, value, ok := strings.Cut(line, ":"); ok {
			switch kind {
			case "full":
				if host := asciiHost(strings.ToLower(value)); looksLikeHost(host) {
					add(&entries.domain, "domain", host)
				}
				continue
			case "domain":
				addDomain(value)
				continue
			case "keyword":
				add(&entries.keyword, "keyword", strings.ToLower(value))
				continue
			case "regexp":
				if _, err := regexp.Compile(value); err == nil {
					add(&entries.regex, "regex", value)
				}
				continue
			}
		}

		fields := strings.Fields(line)
		// A hosts-file line: address, then names.
		if len(fields) >= 2 {
			if _, err := netip.ParseAddr(fields[0]); err == nil {
				for _, name := range fields[1:] {
					if strings.HasPrefix(name, "#") {
						break
					}
					if name != "localhost" && name != "localhost.localdomain" {
						addDomain(name)
					}
				}
				continue
			}
		}
		if len(fields) != 1 {
			continue
		}
		if !addCIDR(fields[0]) {
			addDomain(fields[0])
		}
	}
	return entries
}

// asciiHost turns an internationalised name ("пример.рф") into the form
// connections carry ("xn--e1afmkfd.xn--p1ai"), keeping any wildcard prefix.
// A name that cannot be converted is returned as it was, and fails
// looksLikeHost.
func asciiHost(value string) string {
	prefix := ""
	for _, candidate := range []string{"*.", "+.", "."} {
		if strings.HasPrefix(value, candidate) {
			prefix, value = candidate, value[len(candidate):]
			break
		}
	}
	for _, char := range value {
		if char > 127 {
			if converted, err := idna.Lookup.ToASCII(value); err == nil {
				value = converted
			}
			break
		}
	}
	return prefix + value
}

// looksLikeHost accepts a hostname with at least one dot, in letters, digits,
// hyphens and underscores.
func looksLikeHost(value string) bool {
	if len(value) > 253 || !strings.Contains(value, ".") || strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") {
		return false
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= '0' && char <= '9',
			char == '-', char == '_', char == '.':
		default:
			return false
		}
	}
	return !strings.Contains(value, "..")
}

package xrayconfig

import (
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/Kage/internal/models"
)

// Xray's native Lua router preserves ordered, inverted and logical graph
// rules without approximating them as a different engine's configuration.
type routeCompiler struct {
	request      Request
	declarations strings.Builder
	count        int
}

// Check raw values before UsableRules cleans them. A legacy unsupported
// protocol must fail explicitly rather than silently removing a block rule
// or broadening an inverted/logical rule.
func validateRoutingCapabilities(rules []models.RoutingRule) error {
	for _, rule := range rules {
		if rule.Action == "" {
			continue
		}
		conditions := rule.Conditions
		if rule.Kind != models.SourceLogical {
			conditions = []models.RoutingCondition{rule.Matcher()}
		}
		for _, condition := range conditions {
			for _, value := range condition.Values {
				if condition.Kind == models.SourceProtocol && strings.TrimSpace(value) != "" && !models.ValidProtocol(value) {
					return fmt.Errorf("rule %s: Xray cannot detect protocol %q; choose HTTP, TLS, QUIC or BitTorrent", rule.ID, value)
				}
				if condition.Kind == models.SourceRuleSet && strings.TrimSpace(value) != "" && !models.ValidRuleSetURL(value) {
					return fmt.Errorf("rule %s: use a plain-text or domain/IP JSON rule list; binary SRS/MRS lists are not supported", rule.ID)
				}
			}
		}
	}
	return nil
}

func luaString(value string) string {
	for n := 1; ; n++ {
		eq := strings.Repeat("=", n)
		if !strings.Contains(value, "]"+eq+"]") {
			return "[" + eq + "[" + value + "]" + eq + "]"
		}
	}
}
func luaValues(values []string) string {
	quoted := make([]string, len(values))
	for i, v := range values {
		quoted[i] = luaString(v)
	}
	return strings.Join(quoted, ",")
}

func (c *routeCompiler) matcher(domains, ips []string) string {
	var expressions []string
	if len(domains) > 0 {
		c.count++
		name := fmt.Sprintf("m%d", c.count)
		fmt.Fprintf(&c.declarations, "local %s = geo.BuildDomainMatcher(%s)\n", name, luaValues(domains))
		expressions = append(expressions, name+":MatchAny(domain)")
	}
	if len(ips) > 0 {
		c.count++
		name := fmt.Sprintf("m%d", c.count)
		fmt.Fprintf(&c.declarations, "local %s = geo.BuildIPMatcher(%s)\n", name, luaValues(ips))
		expressions = append(expressions, name+":AnyMatch(ctx:GetTargetIPs())")
	}
	if len(expressions) == 0 {
		return "false"
	}
	return "(" + strings.Join(expressions, " or ") + ")"
}

func domainValues(values []string) []string {
	var result []string
	for _, value := range values {
		switch {
		case strings.Contains(value, ":"):
			result = append(result, value)
		case strings.HasPrefix(value, "*."):
			result = append(result, "regexp:^.+\\."+regexp.QuoteMeta(strings.TrimPrefix(value, "*."))+"$")
		case strings.HasPrefix(value, "+."):
			result = append(result, "domain:"+strings.TrimPrefix(value, "+."))
		case strings.HasPrefix(value, "."):
			result = append(result, "regexp:^.+\\."+regexp.QuoteMeta(strings.TrimPrefix(value, "."))+"$")
		default:
			result = append(result, "domain:"+value)
		}
	}
	return result
}

func (c *routeCompiler) condition(condition models.RoutingCondition) (string, error) {
	var expression string
	values := condition.Values
	switch condition.Kind {
	case models.SourceDomains:
		expression = c.matcher(domainValues(values), nil)
	case models.SourceDomainRegex:
		var rules []string
		for _, v := range values {
			rules = append(rules, "regexp:"+v)
		}
		expression = c.matcher(rules, nil)
	case models.SourceIP:
		expression = c.matcher(nil, values)
	case models.SourcePort:
		var matches []string
		for _, v := range values {
			lo, hi, rangePort := strings.Cut(v, "-")
			if rangePort {
				matches = append(matches, "(port >= "+lo+" and port <= "+hi+")")
			} else {
				matches = append(matches, "port == "+v)
			}
		}
		expression = "(" + strings.Join(matches, " or ") + ")"
	case models.SourceNetwork:
		var matches []string
		for _, v := range values {
			n := "router.NetworkTCP"
			if v == "udp" {
				n = "router.NetworkUDP"
			}
			matches = append(matches, "network == "+n)
		}
		expression = "(" + strings.Join(matches, " or ") + ")"
	case models.SourceProtocol:
		var matches []string
		for _, v := range values {
			matches = append(matches, "protocol == "+luaString(v))
		}
		expression = "(" + strings.Join(matches, " or ") + ")"
	case models.SourceApps:
		if runtime.GOOS == "ios" {
			return "", fmt.Errorf("iOS does not expose connection owners for per-app routing")
		}
		paths := extractProcessPaths(values)
		names := expandProcessNames(values)
		var matches []string
		for _, v := range paths {
			matches = append(matches, "processPath == "+luaString(v))
		}
		for _, v := range names {
			matches = append(matches, "processName == "+luaString(v))
		}
		expression = "(" + strings.Join(matches, " or ") + ")"
	case models.SourceGeoIP, models.SourceGeoSite, models.SourceRuleSet:
		var domains, ips []string
		for _, value := range values {
			file := ""
			if condition.Kind == models.SourceRuleSet {
				list, ok := c.request.RuleLists[value]
				if !ok {
					return "", fmt.Errorf("rule list %s is unavailable; this rule cannot be applied safely", value)
				}
				file = list.Path
			} else {
				file = c.request.LocalRuleSets[RuleSetTag(condition.Kind, value)]
			}
			if file != "" {
				d, i, err := readList(file)
				if err != nil {
					return "", err
				}
				domains = append(domains, d...)
				ips = append(ips, i...)
			} else {
				if c.request.CustomGeo[condition.Kind] {
					return "", fmt.Errorf("%s:%s is absent from the imported database", condition.Kind, value)
				}
				return "", fmt.Errorf("%s:%s requires an imported %s.dat database", condition.Kind, value, condition.Kind)
			}
		}
		expression = c.matcher(domains, ips)
	default:
		return "", fmt.Errorf("unsupported routing condition %q", condition.Kind)
	}
	if expression == "()" || expression == "" {
		return "", fmt.Errorf("empty %s routing condition", condition.Kind)
	}
	if condition.Invert {
		expression = "not (" + expression + ")"
	}
	return expression, nil
}

func buildRouting(request Request, servers map[string]string, lockdown bool) (string, []string, error) {
	c := routeCompiler{request: request}
	c.declarations.WriteString("local geo = require('xray.geodata')\nlocal router = require('xray.router')\n")
	private := c.matcher(nil, []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "fc00::/7", "fe80::/10", "::1/128", "ff00::/8"})
	localNames := c.matcher([]string{"domain:local", "domain:lan", "domain:home.arpa"}, nil)
	var body strings.Builder
	body.WriteString("function HandleRoute(ctx, inbound, sourcePort, port, localPort, domain, network, protocol)\n")
	body.WriteString("if inbound == 'dns-bootstrap' then return 'direct' end\n")
	final := func(action, server string) string {
		switch action {
		case models.ActionDirect:
			return DirectTag
		case models.ActionBlock:
			return "block"
		case models.ActionDrop:
			return "drop"
		}
		if tag := servers[server]; tag != "" {
			return tag
		}
		return ExitTag
	}
	defaultTag := final(request.Settings.DefaultAction, request.Settings.DefaultServer)
	routeExpression := func(tag string) string {
		if tag == ExitTag && len(request.Alternatives) > 1 {
			return "router.PickOutbound('fastest')"
		}
		return luaString(tag)
	}
	if lockdown {
		defaultTag = "drop"
	}
	fmt.Fprintf(&body, "if inbound == 'dns-query' then return %s end\n", routeExpression(defaultTag))
	body.WriteString("if port == 53 then return 'dns-out' end\n")
	fmt.Fprintf(&body, "if %s or %s then return 'direct' end\n", private, localNames)
	// Resolve the owner once per connection, only when a graph or lockdown
	// needs it. Failure to find an owner never broadens an app exception.
	needProcess := lockdown
	for _, r := range request.Settings.UsableRules() {
		for _, m := range r.Matchers() {
			if m.Kind == models.SourceApps {
				needProcess = true
			}
		}
	}
	if needProcess {
		body.WriteString("local pid, processName, processPath = router.FindProcess(ctx)\n")
		if lockdown {
			if own, err := os.Executable(); err == nil {
				fmt.Fprintf(&body, "if processPath == %s then return 'direct' end\n", luaString(own))
			}
		}
	}
	var owners []string
	if !lockdown {
		for _, rule := range request.Settings.UsableRules() {
			var conditions []string
			matchers := []models.RoutingCondition{rule.Matcher()}
			if rule.Kind == models.SourceLogical {
				matchers = rule.UsableConditions()
			}
			for _, condition := range matchers {
				expression, err := c.condition(condition)
				if err != nil {
					return "", nil, fmt.Errorf("rule %s: %w", rule.ID, err)
				}
				conditions = append(conditions, expression)
			}
			join := " and "
			if rule.Mode == models.LogicalOr {
				join = " or "
			}
			expression := "(" + strings.Join(conditions, join) + ")"
			if rule.Kind == models.SourceLogical && rule.Invert {
				expression = "not " + expression
			}
			owner := strconv.Itoa(len(owners))
			owners = append(owners, rule.ID)
			fmt.Fprintf(&body, "if %s then return %s, %s end\n", expression, routeExpression(final(rule.Action, rule.Server)), luaString(owner))
		}
	}
	fmt.Fprintf(&body, "return %s, %s\nend\n", routeExpression(defaultTag), luaString(strconv.Itoa(len(owners))))
	owners = append(owners, DefaultOwner)
	return c.declarations.String() + body.String(), owners, nil
}

package models

import (
	"fmt"
	"strings"
)

// ValidateRoutingRule reports invalid entries to an editor before Normalize
// discards them. It does not change a saved rule or the running connection.
func ValidateRoutingRule(rule RoutingRule) error {
	if !ValidSourceKind(rule.Kind) {
		return fmt.Errorf("choose a supported match type")
	}
	if rule.Action != "" && !ValidAction(rule.Action) {
		return fmt.Errorf("choose a destination")
	}
	conditions := rule.Conditions
	if rule.Kind != SourceLogical {
		conditions = []RoutingCondition{{Kind: rule.Kind, Values: rule.Values}}
	}
	if len(conditions) == 0 {
		return fmt.Errorf("add at least one condition")
	}
	for index, condition := range conditions {
		if !ValidSourceKind(condition.Kind) || condition.Kind == SourceLogical {
			return fmt.Errorf("condition %d has an unsupported match type", index+1)
		}
		if len(condition.Values) == 0 {
			return fmt.Errorf("add at least one entry to condition %d", index+1)
		}
		for _, value := range condition.Values {
			if len((RoutingCondition{Kind: condition.Kind, Values: []string{value}}).CleanValues()) == 0 {
				return fmt.Errorf("%q is not a valid %s entry", value, condition.Kind)
			}
		}
	}
	if strings.TrimSpace(rule.DNS) != "" {
		if rule.Kind != SourceDomains || rule.Invert {
			return fmt.Errorf("custom DNS is only available for non-inverted domain rules; clear the DNS override first")
		}
		if _, ok := ParseDNSServer(rule.DNS); !ok {
			return fmt.Errorf("enter a valid DNS resolver")
		}
	}
	return nil
}

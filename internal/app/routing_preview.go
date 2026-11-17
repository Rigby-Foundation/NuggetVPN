package app

import (
	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/Rigby-Foundation/Kage/internal/xrayconfig"
)

func (a *App) ValidateRoutingRule(rule models.RoutingRule) error {
	return models.ValidateRoutingRule(rule)
}

func (a *App) PreviewDomainMatch(kind string, values []string, hostname string) (xrayconfig.DomainMatchPreview, error) {
	return xrayconfig.PreviewDomainMatch(kind, values, hostname)
}

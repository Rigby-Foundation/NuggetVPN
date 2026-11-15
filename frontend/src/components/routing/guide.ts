import type { MessageKey, Translate } from "@/lib/i18n";
import type { RoutingAction, RoutingKind } from "@/types";

export const ruleGroups = ["everyday", "lists", "advanced"] as const;

export const RULE_GUIDE = {
  apps: {
    title: "routing.source.apps",
    short: "routing.source.apps.hint",
    description: "routing.ui.appsHint",
    example: "Firefox.exe",
    group: "everyday",
  },
  domains: {
    title: "routing.source.domains",
    short: "routing.source.domains.hint",
    description: "routing.ui.domainHint",
    example: "example.com",
    group: "everyday",
  },
  domain_regex: {
    title: "routing.source.regex",
    short: "routing.source.regex.hint",
    description: "routing.ui.regexHint",
    example: "^ads?\\.",
    group: "everyday",
  },
  ip: {
    title: "routing.source.ip",
    short: "routing.source.ip.hint",
    description: "routing.ui.ipHint",
    example: "192.168.0.0/16",
    group: "everyday",
  },
  geosite: {
    title: "routing.source.geosite",
    short: "routing.source.geosite.hint",
    description: "routing.ui.siteHint",
    example: "category-ads-all",
    group: "lists",
  },
  geoip: {
    title: "routing.source.geoip",
    short: "routing.source.geoip.hint",
    description: "routing.ui.geoHint",
    example: "us, de, private",
    group: "lists",
  },
  ruleset: {
    title: "routing.source.ruleset",
    short: "routing.source.ruleset.hint",
    description: "routing.ui.listHint",
    example: "https://example.com/rules.txt",
    group: "lists",
  },
  port: {
    title: "routing.source.port",
    short: "routing.source.port.hint",
    description: "routing.ui.portHint",
    example: "443, 8000-8080",
    group: "advanced",
  },
  protocol: {
    title: "routing.source.protocol",
    short: "routing.source.protocol.hint",
    description: "routing.ui.protocolHint",
    example: "http, tls, quic, bittorrent",
    group: "advanced",
  },
  network: {
    title: "routing.source.network",
    short: "routing.source.network.hint",
    description: "routing.ui.transportHint",
    example: "udp",
    group: "advanced",
  },
  logical: {
    title: "routing.source.logical",
    short: "routing.source.logical.hint",
    description: "routing.ui.logicHint",
    example: "",
    group: "advanced",
  },
} as const satisfies Record<
  RoutingKind,
  {
    title: MessageKey;
    short: MessageKey;
    description: MessageKey;
    example: string;
    group: (typeof ruleGroups)[number];
  }
>;

export const DESTINATIONS = {
  proxy: {
    title: "routing.ui.vpn",
    description: "routing.action.proxy.hint",
    detail: "routing.action.proxy.status",
  },
  direct: {
    title: "routing.action.direct",
    description: "routing.action.direct.hint",
    detail: "routing.action.direct.status",
  },
  block: {
    title: "routing.action.block",
    description: "routing.action.block.hint",
    detail: "routing.action.block.status",
  },
  drop: {
    title: "routing.action.drop",
    description: "routing.action.drop.hint",
    detail: "routing.action.drop.status",
  },
} as const satisfies Record<
  RoutingAction,
  { title: MessageKey; description: MessageKey; detail: MessageKey }
>;

export function ruleSummary(t: Translate, count: number) {
  return count ? t("routing.entries", { count }) : t("routing.emptyRule");
}

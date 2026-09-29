import { useMemo, useState } from "react";
import { ArrowDownUp, Ban, Flag, Magnet } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MessageKey, useI18n, useT } from "@/lib/i18n";
import { RoutingRule } from "@/types";

/** A rule a preset adds, before it has an id. */
export type PresetRule = Omit<RoutingRule, "id">;

/**
 * Where a preset's rules go. Rules are matched top to bottom: a preset that
 * blocks belongs before everything, so no other rule lets the traffic through
 * first; one that sends traffic direct belongs after the user's own rules, so
 * it does not override a site they chose to tunnel.
 */
export type PresetPlacement = "first" | "last";

interface Preset {
    id: string;
    label: MessageKey;
    hint: MessageKey;
    icon: typeof Ban;
    placement: PresetPlacement;
    rules: () => PresetRule[];
}

const PRESETS: Preset[] = [
    {
        id: "ads",
        label: "routing.preset.ads",
        hint: "routing.preset.ads.hint",
        icon: Ban,
        placement: "first",
        rules: () => [{ kind: "geosite", values: ["category-ads-all"], action: "block" }],
    },
    {
        id: "quic",
        label: "routing.preset.quic",
        hint: "routing.preset.quic.hint",
        icon: ArrowDownUp,
        placement: "first",
        rules: () => [
            {
                kind: "logical",
                mode: "and",
                values: [],
                conditions: [
                    { kind: "network", values: ["udp"] },
                    { kind: "port", values: ["443"] },
                ],
                action: "block",
            },
        ],
    },
    {
        id: "torrents",
        label: "routing.preset.torrents",
        hint: "routing.preset.torrents.hint",
        icon: Magnet,
        placement: "last",
        rules: () => [{ kind: "protocol", values: ["bittorrent"], action: "direct" }],
    },
];

/**
 * Countries offered for "direct for my country". Any other two-letter code
 * can be typed. The names come from the browser, in the UI's language.
 */
const COUNTRIES = [
    "ru", "ua", "by", "kz", "uz", "cn", "ir", "tr", "de", "gb", "fr", "nl", "pl", "us", "ca", "jp", "kr", "in", "br", "ae",
];

/**
 * A country's own top-level domains. Most have one, the code itself; some
 * also have a Cyrillic or Chinese one, written as it travels on the wire.
 */
const COUNTRY_DOMAINS: Record<string, string[]> = {
    ru: ["ru", "su", "xn--p1ai"],
    by: ["by", "xn--90ais"],
    kz: ["kz", "xn--80ao21a"],
    ua: ["ua", "xn--j1amh"],
    cn: ["cn", "xn--fiqs8s"],
    gb: ["uk"],
};

/** Traffic to a country — its addresses or its domains — goes direct. */
function countryRules(code: string): PresetRule[] {
    return [
        {
            kind: "logical",
            mode: "or",
            values: [],
            conditions: [
                { kind: "geoip", values: [code] },
                { kind: "domains", values: COUNTRY_DOMAINS[code] ?? [code] },
            ],
            action: "direct",
        },
    ];
}

/** The presets, as a section of the palette. */
export function PresetList({ onAdd }: { onAdd: (rules: PresetRule[], placement: PresetPlacement) => void }) {
    const t = useT();
    const { language } = useI18n();
    const [code, setCode] = useState("");

    const names = useMemo(() => {
        try {
            return new Intl.DisplayNames([language], { type: "region" });
        } catch {
            return null;
        }
    }, [language]);
    const countryName = (value: string) => names?.of(value.toUpperCase()) ?? value.toUpperCase();

    const typed = code.trim().toLowerCase();
    const typedValid = /^[a-z]{2}$/.test(typed);

    const itemClass =
        "w-full flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-start";

    return (
        <>
            <p className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">{t("routing.presets")}</p>
            {PRESETS.map((preset) => (
                <button
                    key={preset.id}
                    type="button"
                    onClick={() => onAdd(preset.rules(), preset.placement)}
                    title={t(preset.hint)}
                    className={itemClass}
                >
                    <preset.icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                        <span className="block truncate">{t(preset.label)}</span>
                        <span className="block text-[11px] leading-snug text-muted-foreground">{t(preset.hint)}</span>
                    </span>
                </button>
            ))}

            <DropdownMenu onOpenChange={(open) => (open ? undefined : setCode(""))}>
                <DropdownMenuTrigger asChild>
                    <button type="button" className={itemClass}>
                        <Flag size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0">
                            <span className="block truncate">{t("routing.preset.country")}</span>
                            <span className="block text-[11px] leading-snug text-muted-foreground">
                                {t("routing.preset.country.hint")}
                            </span>
                        </span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="left" className="w-60 max-h-80 overflow-y-auto">
                    <form
                        className="p-1"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (typedValid) onAdd(countryRules(typed), "last");
                        }}
                    >
                        <Input
                            value={code}
                            maxLength={2}
                            onChange={(event) => setCode(event.target.value)}
                            // Typing in the field must not jump the menu to an item.
                            onKeyDown={(event) => event.stopPropagation()}
                            placeholder={t("routing.preset.countryCode")}
                            aria-label={t("routing.preset.countryCode")}
                            className="h-7 text-xs"
                        />
                    </form>
                    {typedValid && !COUNTRIES.includes(typed) ? (
                        <DropdownMenuItem className="text-xs" onClick={() => onAdd(countryRules(typed), "last")}>
                            {countryName(typed)}
                            <span className="ms-auto font-mono text-muted-foreground">{typed}</span>
                        </DropdownMenuItem>
                    ) : null}
                    {COUNTRIES.filter(
                        (country) =>
                            !typed || country.startsWith(typed) || countryName(country).toLowerCase().includes(typed)
                    ).map((country) => (
                        <DropdownMenuItem key={country} className="text-xs" onClick={() => onAdd(countryRules(country), "last")}>
                            {countryName(country)}
                            <span className="ms-auto font-mono text-muted-foreground">{country}</span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}

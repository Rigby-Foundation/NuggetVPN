import { createContext, KeyboardEvent, useContext, useEffect, useMemo, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
    ArrowDownUp,
    Ban,
    CircleOff,
    Combine,
    Globe2,
    Hash,
    Landmark,
    ListChecks,
    Loader2,
    Radio,
    RefreshCw,
    Regex,
    Search,
    Server,
    Shrink,
    StickyNote,
    Globe,
    MonitorSmartphone,
    MoreHorizontal,
    Network,
    Plus,
    Shield,
    Trash2,
    ArrowRightLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageKey, useI18n, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RoutingAction, RoutingCondition, RoutingKind, RoutingSource, RuleListStatus } from "@/types";

/**
 * Presentation for each source kind. Colour carries meaning here — an edge is
 * drawn in its source's colour, so you can trace where a rule goes without
 * reading it.
 */
export const SOURCE_META: Record<
    RoutingSource,
    { label: MessageKey; hint: MessageKey; icon: typeof Globe; accent: string; placeholder: string }
> = {
    apps: {
        label: "routing.source.apps",
        hint: "routing.source.apps.hint",
        icon: MonitorSmartphone,
        accent: "var(--routing-apps)",
        placeholder: "Firefox.exe",
    },
    domains: {
        label: "routing.source.domains",
        hint: "routing.source.domains.hint",
        icon: Globe,
        accent: "var(--routing-domains)",
        placeholder: "example.com",
    },
    ip: {
        label: "routing.source.ip",
        hint: "routing.source.ip.hint",
        icon: Network,
        accent: "var(--routing-ip)",
        placeholder: "1.1.1.0/24",
    },
    domain_regex: {
        label: "routing.source.regex",
        hint: "routing.source.regex.hint",
        icon: Regex,
        accent: "var(--routing-domains)",
        placeholder: "^ads?\\.",
    },
    port: {
        label: "routing.source.port",
        hint: "routing.source.port.hint",
        icon: Hash,
        accent: "var(--routing-port)",
        placeholder: "443 or 8000-8080",
    },
    protocol: {
        label: "routing.source.protocol",
        hint: "routing.source.protocol.hint",
        icon: Radio,
        accent: "var(--routing-protocol)",
        placeholder: "quic",
    },
    network: {
        label: "routing.source.network",
        hint: "routing.source.network.hint",
        icon: ArrowDownUp,
        accent: "var(--routing-port)",
        placeholder: "udp",
    },
    geosite: {
        label: "routing.source.geosite",
        hint: "routing.source.geosite.hint",
        icon: Landmark,
        accent: "var(--routing-geo)",
        placeholder: "netflix",
    },
    geoip: {
        label: "routing.source.geoip",
        hint: "routing.source.geoip.hint",
        icon: Globe2,
        accent: "var(--routing-geo)",
        placeholder: "ru",
    },
    ruleset: {
        label: "routing.source.ruleset",
        hint: "routing.source.ruleset.hint",
        icon: ListChecks,
        accent: "var(--routing-geo)",
        placeholder: "https://…/list.txt",
    },
};

/** A combined rule: several conditions, all or any of them. */
export const LOGICAL_META = {
    label: "routing.source.logical" as MessageKey,
    hint: "routing.source.logical.hint" as MessageKey,
    icon: Combine,
    accent: "var(--routing-protocol)",
};

/** The meta for any rule kind, combined rules included. */
export function kindMeta(kind: RoutingKind) {
    return kind === "logical" ? { ...LOGICAL_META, placeholder: "" } : SOURCE_META[kind];
}

/** Rule kinds whose matches have domain names a DNS server can resolve. */
export const DOMAIN_KINDS: RoutingKind[] = ["domains", "domain_regex", "geosite", "ruleset", "logical"];

/** What a protocol rule may match; the core detects these by sniffing. */
export const SNIFFABLE_PROTOCOLS = [
    "tls", "http", "quic", "dns", "stun", "bittorrent", "dtls", "ssh", "rdp", "ntp",
] as const;

/** What a network rule may match. */
export const NETWORKS = ["tcp", "udp"] as const;

export const ACTION_META: Record<
    RoutingAction,
    { label: MessageKey; hint: MessageKey; status: MessageKey; icon: typeof Shield; accent: string }
> = {
    proxy: {
        label: "routing.action.proxy",
        hint: "routing.action.proxy.hint",
        status: "routing.action.proxy.status",
        icon: Shield,
        accent: "var(--status-connected)",
    },
    direct: {
        label: "routing.action.direct",
        hint: "routing.action.direct.hint",
        status: "routing.action.direct.status",
        icon: ArrowRightLeft,
        accent: "var(--routing-direct)",
    },
    block: {
        label: "routing.action.block",
        hint: "routing.action.block.hint",
        status: "routing.action.block.status",
        icon: Ban,
        accent: "var(--status-error)",
    },
    drop: {
        label: "routing.action.drop",
        hint: "routing.action.drop.hint",
        status: "routing.action.drop.status",
        icon: CircleOff,
        accent: "color-mix(in oklab, var(--status-error) 55%, var(--muted-foreground))",
    },
};

/**
 * Accepts the resolver addresses the backend does (models.ParseDNSServer),
 * so a typo is flagged while typing rather than silently ignored on connect.
 */
export function validDnsAddress(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    if (/^(local|system)$/i.test(text)) return true;
    let parsed: URL;
    try {
        parsed = new URL(text.includes("://") ? text : `udp://${text}`);
    } catch {
        return false;
    }
    const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
    if (!["udp", "tcp", "tls", "quic", "https", "h3", "http3"].includes(scheme)) return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (!host) return false;
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
    if (!ip && !/^([a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/i.test(host)) return false;
    const path = parsed.pathname;
    const web = scheme === "https" || scheme === "h3" || scheme === "http3";
    return web || path === "" || path === "/";
}

/** Shared chrome: an accent bar, an icon, a title and a subtitle. */
/** What every node gets from the canvas to be resizable. */
export interface BoxData {
    /** True once the user has resized the node. */
    sized?: boolean;
    onResize?: (box: { x: number; y: number; width: number; height: number }) => void;
    onResetSize?: () => void;
}

/**
 * The resize frame, drawn while the node is selected. Resizing from the left
 * or top moves the node as well, which onResizeEnd reports along with the size.
 */
function Resizer({ box, selected, accent, minWidth }: { box?: BoxData; selected?: boolean; accent: string; minWidth: number }) {
    if (!box?.onResize) return null;
    return (
        <NodeResizer
            isVisible={!!selected}
            minWidth={minWidth}
            minHeight={90}
            color={accent}
            handleStyle={{ width: 9, height: 9, borderRadius: 3 }}
            onResizeEnd={(_, params) => box.onResize?.(params)}
        />
    );
}

function NodeShell({
    accent,
    icon: Icon,
    title,
    subtitle,
    selected,
    onDelete,
    hits,
    order,
    wide,
    box,
    children,
}: {
    accent: string;
    icon: typeof Globe;
    title: string;
    subtitle: string;
    selected?: boolean;
    onDelete?: () => void;
    /** Connections the rule is carrying now; undefined while disconnected. */
    hits?: number;
    /** The rule's place in the order the core checks them. */
    order?: number;
    wide?: boolean;
    box?: BoxData;
    children?: React.ReactNode;
}) {
    const t = useT();
    return (
        <>
        <Resizer box={box} selected={selected} accent={accent} minWidth={wide ? 260 : 200} />
        <div
            className={cn(
                // A resized node fills the box React Flow gives it, and its
                // body scrolls when the box is shorter than the content.
                box?.sized ? "flex h-full w-full flex-col" : wide ? "w-80" : "w-64",
                "rounded-xl border bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden",
                "transition-shadow",
                selected ? "ring-2 ring-offset-2 ring-offset-background" : ""
            )}
            style={{
                borderColor: accent,
                ...(selected ? ({ ["--tw-ring-color" as string]: accent } as object) : {}),
            }}
        >
            <div className="h-0.5 w-full shrink-0" style={{ background: accent }} />

            <div className="flex shrink-0 items-start gap-2.5 px-3.5 pt-3 pb-2.5">
                <span
                    className="mt-0.5 shrink-0"
                    style={{ color: accent }}
                    aria-hidden="true"
                >
                    <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-tight truncate">
                        {order !== undefined ? (
                            <span className="me-1.5 text-muted-foreground tabular-nums">{order}.</span>
                        ) : null}
                        {title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                        {subtitle}
                    </span>
                </span>
                {hits !== undefined ? <HitsBadge count={hits} accent={accent} /> : null}
                {box?.sized && box.onResetSize ? (
                    <button
                        type="button"
                        onClick={box.onResetSize}
                        aria-label={t("routing.resetSize")}
                        title={t("routing.resetSize")}
                        className="nodrag shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                        <Shrink size={13} aria-hidden="true" />
                    </button>
                ) : null}
                {onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        aria-label={t("routing.remove", { name: title })}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 size={13} aria-hidden="true" />
                    </button>
                ) : null}
            </div>

            {box?.sized ? (
                <div className="nowheel min-h-0 flex-1 overflow-y-auto">{children}</div>
            ) : (
                children
            )}
        </div>
        </>
    );
}

/** How many connections a rule is carrying right now. */
function HitsBadge({ count, accent }: { count: number; accent: string }) {
    const t = useT();
    const label = t("routing.hits", { count });
    return (
        <span
            className={cn(
                "shrink-0 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                count > 0 ? "bg-muted text-foreground" : "text-muted-foreground"
            )}
            title={label}
            aria-label={label}
        >
            <span
                className={cn("h-1.5 w-1.5 rounded-full", count > 0 ? "animate-pulse" : "opacity-40")}
                style={{ background: count > 0 ? accent : "var(--muted-foreground)" }}
                aria-hidden="true"
            />
            {count}
        </span>
    );
}

/**
 * A closed set of values, as chips to click.
 *
 * Protocols and networks are closed sets — the ones the core can detect — so
 * there is nothing to type. This used to be a text field with a <datalist>,
 * which every engine draws as a native popup that ignores the app's styling
 * entirely, and which still let you type something the backend would reject.
 */
function ChoiceChips({
    options,
    values,
    onChange,
}: {
    options: readonly string[];
    values: string[];
    onChange: (values: string[]) => void;
}) {
    const t = useT();
    const remaining = options.filter((option) => !values.includes(option));
    if (remaining.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-1 pt-1.5">
            {remaining.map((option) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onChange([...values, option])}
                    aria-label={t("routing.add", { name: option })}
                    className="nodrag flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
                >
                    <Plus size={10} aria-hidden="true" />
                    {option}
                </button>
            ))}
        </div>
    );
}

/** Short lists show in full; longer ones collapse to this many rows. */
const COLLAPSED_ROWS = 6;
/** The most rows an expanded list draws at once; the filter narrows the rest. */
const EXPANDED_ROWS = 100;

function ValueRow({ value, detail, onRemove }: { value: string; detail?: string; onRemove: () => void }) {
    const t = useT();
    return (
        <div className="group flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
            <span className="flex-1 min-w-0">
                <span className="block truncate font-mono text-[11px]" title={value}>
                    {value}
                </span>
                {detail ? <span className="block truncate text-[10px] text-muted-foreground">{detail}</span> : null}
            </span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={t("routing.remove", { name: value })}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
            >
                <Trash2 size={12} aria-hidden="true" />
            </button>
        </div>
    );
}

/**
 * A rule's entries, drawn in bounded size.
 *
 * Every entry used to be its own row, so a rule holding a few thousand
 * addresses put tens of thousands of elements into the canvas, and opening
 * Routing took seconds while they were built and measured. A node is a
 * summary on a map, not the place to read a thousand addresses one by one:
 * a long list collapses to its first few, and expanding it gives a scrolling
 * list with a filter, which is how you would look for one of them anyway.
 */
function ValueList({
    values,
    onChange,
    detail,
}: {
    values: string[];
    onChange: (values: string[]) => void;
    detail?: (value: string) => string | undefined;
}) {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const [filter, setFilter] = useState("");

    const remove = (value: string) => onChange(values.filter((item) => item !== value));
    const row = (value: string) => (
        <ValueRow key={value} value={value} detail={detail?.(value)} onRemove={() => remove(value)} />
    );
    const needle = filter.trim().toLowerCase();
    const matches = useMemo(
        () => (needle ? values.filter((value) => value.toLowerCase().includes(needle)) : values),
        [values, needle]
    );

    if (values.length <= COLLAPSED_ROWS + 2) {
        // Not worth collapsing two rows behind a button.
        return <>{values.map(row)}</>;
    }

    if (!expanded) {
        return (
            <>
                {values.slice(0, COLLAPSED_ROWS).map(row)}
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="nodrag w-full rounded-md py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                    {t("routing.showAll", { count: values.length })}
                </button>
            </>
        );
    }

    const shown = matches.slice(0, EXPANDED_ROWS);
    return (
        <div className="space-y-1">
            <div className="relative">
                <Search
                    size={11}
                    className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("routing.filterPlaceholder", { count: values.length })}
                    aria-label={t("routing.filter")}
                    className="nodrag h-7 ps-6 text-[11px] font-mono"
                />
            </div>
            {/* nowheel: scrolling here scrolls the list, not the canvas. */}
            <div className="nowheel nodrag max-h-60 space-y-1 overflow-y-auto pe-0.5">
                {shown.map(row)}
                {shown.length === 0 ? (
                    <p className="py-1.5 text-center text-[11px] text-muted-foreground">{t("routing.noMatch")}</p>
                ) : null}
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                    {matches.length > shown.length
                        ? t("routing.shownOf", { shown: shown.length, count: matches.length })
                        : t(needle ? "routing.matching" : "routing.entries", { count: matches.length })}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        setExpanded(false);
                        setFilter("");
                    }}
                    className="nodrag hover:text-foreground"
                >
                    {t("routing.collapse")}
                </button>
            </div>
        </div>
    );
}

/**
 * The codes in the user's own geoip.dat / geosite.dat, by kind. Provided by
 * the routing view; empty when the built-in rule-sets are in use.
 */
export const GeoCodesContext = createContext<Partial<Record<string, string[]>>>({});

/** What the backend knows about each rule list, by URL, and a way to refresh them. */
export const RuleListsContext = createContext<{
    lists: Record<string, RuleListStatus>;
    updating: boolean;
    update: () => void;
}>({ lists: {}, updating: false, update: () => undefined });

/**
 * Codes from the user's file that match what is being typed.
 *
 * A custom file's codes are whatever its author chose — "ru-blocked",
 * "category-ads-all" — so the node offers them rather than leaving them to be
 * guessed. Picking one keeps focus in the input: the input commits on blur,
 * and a click that blurred it first would add the half-typed text as well.
 */
function GeoSuggestions({
    kind,
    draft,
    values,
    onPick,
}: {
    kind: string;
    draft: string;
    values: string[];
    onPick: (code: string) => void;
}) {
    const t = useT();
    const codes = useContext(GeoCodesContext)[kind];
    if (!codes || codes.length === 0) {
        return null;
    }
    const needle = draft.trim().toLowerCase().split("@")[0];
    if (!needle) {
        return (
            <p className="pt-1 text-[10px] text-muted-foreground">
                {t("routing.geoCodes", { count: codes.length, file: `${kind}.dat` })}
            </p>
        );
    }
    // Closest first: the code itself, then codes starting with it, then codes
    // with a segment starting with it ("ads" -> "category-ads"), then any
    // code merely containing it ("goodreads"). Shorter wins a tie.
    const rank = (code: string) =>
        code === needle ? 0
        : code.startsWith(needle) ? 1
        : code.split(/[-_@!]/).some((segment) => segment.startsWith(needle)) ? 2
        : 3;
    const matches = codes
        .filter((code) => code.includes(needle) && !values.includes(code))
        .sort((a, b) => rank(a) - rank(b) || a.length - b.length)
        .slice(0, 8);
    if (matches.length === 0) {
        return <p className="pt-1 text-[10px] text-muted-foreground">{t("routing.geoMissing", { file: `${kind}.dat` })}</p>;
    }
    return (
        <div className="flex flex-wrap gap-1 pt-1.5">
            {matches.map((code) => (
                <button
                    key={code}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(code)}
                    className="nodrag rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:border-solid hover:bg-muted hover:text-foreground"
                >
                    {code}
                </button>
            ))}
        </div>
    );
}

/** A rule list's state, under its URL. */
function useListDetail() {
    const t = useT();
    const { language } = useI18n();
    const { lists } = useContext(RuleListsContext);
    return (url: string) => {
        const status = lists[url];
        if (!status) return t("routing.list.pending");
        if (status.native) return t("routing.list.native");
        if (!status.updated_at) return t("routing.list.pending");
        const date = new Date(status.updated_at * 1000).toLocaleDateString(language);
        return t("routing.list.entries", { count: status.entries, date });
    };
}

/**
 * The entries of one matcher and the ways to add to them: a text field, chips
 * for a closed set, suggestions from the user's geo files.
 */
function EntryEditor({
    kind,
    values,
    onChange,
}: {
    kind: RoutingSource;
    values: string[];
    onChange: (values: string[]) => void;
}) {
    const meta = SOURCE_META[kind];
    const t = useT();
    const [draft, setDraft] = useState("");
    const listDetail = useListDetail();
    const lists = useContext(RuleListsContext);

    const commit = () => {
        const value = draft.trim();
        if (!value) {
            return;
        }
        if (!values.includes(value)) {
            onChange([...values, value]);
        }
        setDraft("");
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        }
    };

    const choices = kind === "protocol" ? SNIFFABLE_PROTOCOLS : kind === "network" ? NETWORKS : null;

    return (
        <div className="space-y-1">
            {values.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1.5">{t("routing.emptyRule")}</p>
            ) : (
                <ValueList values={values} onChange={onChange} detail={kind === "ruleset" ? listDetail : undefined} />
            )}

            {choices ? (
                <ChoiceChips options={choices} values={values} onChange={onChange} />
            ) : (
                <div className="flex items-center gap-1.5 pt-1">
                    <Input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={commit}
                        placeholder={meta.placeholder}
                        aria-label={t("routing.addTo", { name: t(meta.label) })}
                        className="h-7 text-[11px] font-mono nodrag"
                    />
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={commit}
                        aria-label={t("routing.addTo", { name: t(meta.label) })}
                        className="h-7 w-7 shrink-0"
                    >
                        <Plus size={13} aria-hidden="true" />
                    </Button>
                </div>
            )}
            {kind === "geosite" || kind === "geoip" ? (
                <GeoSuggestions
                    kind={kind}
                    draft={draft}
                    values={values}
                    onPick={(code) => {
                        if (!values.includes(code)) onChange([...values, code]);
                        setDraft("");
                    }}
                />
            ) : null}
            {kind === "ruleset" && values.length > 0 ? (
                <button
                    type="button"
                    onClick={lists.update}
                    disabled={lists.updating}
                    className="nodrag flex items-center gap-1 pt-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                    {lists.updating ? (
                        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
                    ) : (
                        <RefreshCw size={11} aria-hidden="true" />
                    )}
                    {t("routing.list.update")}
                </button>
            ) : null}
        </div>
    );
}

/**
 * The options every rule has below its entries: match everything except
 * them, and, for rules about domains, which DNS server resolves them.
 */
function RuleOptions({
    kind,
    action,
    invert,
    dns,
    onChange,
}: {
    kind: RoutingKind;
    action: RoutingAction;
    invert: boolean;
    dns: string;
    onChange: (patch: { invert?: boolean; dns?: string }) => void;
}) {
    const t = useT();
    const [dnsOpen, setDnsOpen] = useState(dns !== "");
    const [draft, setDraft] = useState(dns);
    useEffect(() => setDraft(dns), [dns]);
    useEffect(() => {
        if (dns) setDnsOpen(true);
    }, [dns]);

    // A blocked rule's names are never looked up, and "everything except
    // these domains" is not a list of names to send to a resolver.
    const canDns = DOMAIN_KINDS.includes(kind) && action !== "block" && action !== "drop" && !invert;
    const invalid = draft.trim() !== "" && !validDnsAddress(draft);
    const save = () => {
        const next = draft.trim();
        if (next !== dns && (next === "" || validDnsAddress(next))) onChange({ dns: next });
    };

    return (
        <div className="border-t px-3.5 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => onChange({ invert: !invert })}
                    aria-pressed={invert}
                    title={t("routing.invert.hint")}
                    className={cn(
                        "nodrag rounded-md border px-1.5 py-0.5 text-[11px] transition-colors",
                        invert
                            ? "border-foreground/30 bg-foreground text-background"
                            : "border-dashed text-muted-foreground hover:border-solid hover:text-foreground"
                    )}
                >
                    {t("routing.invert")}
                </button>
                {canDns && !dnsOpen ? (
                    <button
                        type="button"
                        onClick={() => setDnsOpen(true)}
                        title={t("routing.dns.hint")}
                        className="nodrag rounded-md border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-solid hover:text-foreground"
                    >
                        {t("routing.dns")}
                    </button>
                ) : null}
            </div>
            {canDns && dnsOpen ? (
                <div>
                    <label className="block text-[10px] text-muted-foreground pb-0.5" htmlFor={undefined}>
                        {t("routing.dns.label")}
                    </label>
                    <div className="flex items-center gap-1">
                        <Input
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={save}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    save();
                                }
                            }}
                            placeholder="https://dns.google/dns-query"
                            aria-label={t("routing.dns.label")}
                            aria-invalid={invalid}
                            className={cn("nodrag h-7 text-[11px] font-mono", invalid ? "border-destructive" : "")}
                        />
                        <button
                            type="button"
                            onClick={() => {
                                setDraft("");
                                setDnsOpen(false);
                                if (dns) onChange({ dns: "" });
                            }}
                            aria-label={t("routing.dns.remove")}
                            className="nodrag shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 size={12} aria-hidden="true" />
                        </button>
                    </div>
                    <p className={cn("pt-0.5 text-[10px]", invalid ? "text-destructive" : "text-muted-foreground")}>
                        {invalid ? t("routing.dns.invalid") : t("routing.dns.hint")}
                    </p>
                </div>
            ) : null}
        </div>
    );
}

export interface CommentNodeData {
    text: string;
    onChange: (text: string) => void;
    onDelete: () => void;
    [key: string]: unknown;
}

/**
 * A note on the canvas. It routes nothing; it is there to say why a rule
 * exists, for whoever reads the graph next — including its author later.
 * It saves when it loses focus rather than on every keystroke.
 */
export function CommentNode({ data, selected }: NodeProps) {
    const { text, onChange, onDelete } = data as CommentNodeData;
    const box = data as BoxData;
    const t = useT();
    const [draft, setDraft] = useState(text);
    useEffect(() => setDraft(text), [text]);

    return (
        <>
        <Resizer box={box} selected={selected} accent="var(--muted-foreground)" minWidth={160} />
        <div
            className={cn(
                // Resized, the text area takes whatever height the box has.
                box.sized ? "flex h-full w-full flex-col" : "w-60",
                "rounded-xl border border-dashed bg-card/85 shadow-sm backdrop-blur-sm",
                selected ? "ring-2 ring-ring/50" : ""
            )}
        >
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 text-muted-foreground">
                <StickyNote size={13} aria-hidden="true" />
                <span className="flex-1 text-xs font-medium">{t("routing.note")}</span>
                {box.sized && box.onResetSize ? (
                    <button
                        type="button"
                        onClick={box.onResetSize}
                        aria-label={t("routing.resetSize")}
                        title={t("routing.resetSize")}
                        className="rounded p-1 hover:bg-muted hover:text-foreground"
                    >
                        <Shrink size={12} aria-hidden="true" />
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={onDelete}
                    aria-label={t("routing.removeNote")}
                    className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                >
                    <Trash2 size={12} aria-hidden="true" />
                </button>
            </div>
            <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    if (draft !== text) onChange(draft);
                }}
                placeholder={t("routing.notePlaceholder")}
                aria-label={t("routing.note")}
                maxLength={2000}
                rows={3}
                className={cn(
                    "nodrag nowheel mt-1 block w-full resize-none bg-transparent px-3 pb-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60",
                    box.sized ? "min-h-0 flex-1" : "min-h-16 [field-sizing:content]"
                )}
            />
        </div>
        </>
    );
}

/** What changes a rule node can make to its rule. */
export interface RulePatch {
    values?: string[];
    invert?: boolean;
    dns?: string;
    mode?: "and" | "or";
    conditions?: RoutingCondition[];
}

export interface SourceNodeData {
    kind: RoutingSource;
    values: string[];
    action: RoutingAction;
    invert: boolean;
    dns: string;
    hits?: number;
    order?: number;
    onChange: (patch: RulePatch) => void;
    onDelete: () => void;
    [key: string]: unknown;
}

/** A traffic source: a list of entries plus an output port. */
export function SourceNode({ data, selected }: NodeProps) {
    const { kind, values, action, invert, dns, hits, order, onChange, onDelete } = data as SourceNodeData;
    const meta = SOURCE_META[kind];
    const t = useT();

    return (
        <NodeShell
            accent={meta.accent}
            icon={meta.icon}
            title={t(meta.label)}
            subtitle={invert ? t("routing.invert.hint") : t(meta.hint)}
            selected={selected}
            box={data as BoxData}
            onDelete={onDelete}
            hits={hits}
            order={order}
        >
            <div className="px-3.5 pb-3">
                <EntryEditor kind={kind} values={values} onChange={(next) => onChange({ values: next })} />
            </div>
            <RuleOptions kind={kind} action={action} invert={invert} dns={dns} onChange={onChange} />

            <Handle
                type="source"
                position={Position.Right}
                style={{ background: meta.accent, width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

/** Kinds a combined rule's condition can be. */
const CONDITION_KINDS: RoutingSource[] = [
    "apps", "domains", "domain_regex", "ip", "port", "protocol", "network", "geosite", "geoip", "ruleset",
];

export interface LogicalNodeData {
    mode: "and" | "or";
    conditions: RoutingCondition[];
    action: RoutingAction;
    invert: boolean;
    dns: string;
    hits?: number;
    order?: number;
    onChange: (patch: RulePatch) => void;
    onDelete: () => void;
    [key: string]: unknown;
}

/**
 * A combined rule: conditions that must all match, or any one of them. Each
 * condition can be negated on its own — "Telegram, and not TCP" — and the
 * whole rule too.
 */
export function LogicalNode({ data, selected }: NodeProps) {
    const { mode, conditions, action, invert, dns, hits, order, onChange, onDelete } = data as LogicalNodeData;
    const t = useT();

    const setCondition = (index: number, patch: Partial<RoutingCondition>) =>
        onChange({
            conditions: conditions.map((condition, position) =>
                position === index ? { ...condition, ...patch } : condition
            ),
        });

    return (
        <NodeShell
            accent={LOGICAL_META.accent}
            icon={LOGICAL_META.icon}
            title={t(LOGICAL_META.label)}
            subtitle={invert ? t("routing.invert.hint") : t(LOGICAL_META.hint)}
            selected={selected}
            box={data as BoxData}
            onDelete={onDelete}
            hits={hits}
            order={order}
            wide
        >
            <div className="px-3.5 pb-3 space-y-2">
                <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted/60 p-0.5" role="radiogroup" aria-label={t("routing.logical.mode")}>
                    {(["and", "or"] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={mode === option}
                            onClick={() => onChange({ mode: option })}
                            className={cn(
                                "nodrag rounded-md py-1 text-[11px] transition-colors",
                                mode === option ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {t(option === "and" ? "routing.logical.all" : "routing.logical.any")}
                        </button>
                    ))}
                </div>

                {conditions.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">{t("routing.logical.empty")}</p>
                ) : null}

                {conditions.map((condition, index) => {
                    const meta = SOURCE_META[condition.kind];
                    return (
                        <div key={index} className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: `color-mix(in oklab, ${meta.accent} 45%, var(--border))` }}>
                            {index > 0 ? (
                                <span className="-mt-4 mb-0.5 block w-fit rounded bg-card px-1 text-[10px] text-muted-foreground">
                                    {t(mode === "and" ? "routing.logical.and" : "routing.logical.or")}
                                </span>
                            ) : null}
                            <div className="flex items-center gap-1.5">
                                <meta.icon size={13} style={{ color: meta.accent }} className="shrink-0" aria-hidden="true" />
                                <Select
                                    value={condition.kind}
                                    onValueChange={(kind) =>
                                        // A new kind starts empty: an app name is not a port.
                                        setCondition(index, { kind: kind as RoutingSource, values: [] })
                                    }
                                >
                                    <SelectTrigger size="sm" className="nodrag data-[size=sm]:h-7 flex-1 min-w-0 px-2 text-[11px]" aria-label={t("routing.logical.kind")}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CONDITION_KINDS.map((kind) => (
                                            <SelectItem key={kind} value={kind} className="text-xs">
                                                {t(SOURCE_META[kind].label)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <button
                                    type="button"
                                    onClick={() => setCondition(index, { invert: !condition.invert })}
                                    aria-pressed={!!condition.invert}
                                    title={t("routing.invert.hint")}
                                    className={cn(
                                        "nodrag shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]",
                                        condition.invert
                                            ? "border-foreground/30 bg-foreground text-background"
                                            : "border-dashed text-muted-foreground hover:border-solid hover:text-foreground"
                                    )}
                                >
                                    {t("routing.condition.not")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onChange({ conditions: conditions.filter((_, position) => position !== index) })}
                                    aria-label={t("routing.remove", { name: t(meta.label) })}
                                    className="nodrag shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                >
                                    <Trash2 size={12} aria-hidden="true" />
                                </button>
                            </div>
                            <EntryEditor
                                kind={condition.kind}
                                values={condition.values ?? []}
                                onChange={(values) => setCondition(index, { values })}
                            />
                        </div>
                    );
                })}

                <button
                    type="button"
                    onClick={() => onChange({ conditions: [...conditions, { kind: "domains", values: [] }] })}
                    className="nodrag flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1 text-[11px] text-muted-foreground hover:border-solid hover:bg-muted/50 hover:text-foreground"
                >
                    <Plus size={11} aria-hidden="true" />
                    {t("routing.logical.addCondition")}
                </button>
            </div>
            <RuleOptions kind="logical" action={action} invert={invert} dns={dns} onChange={onChange} />

            <Handle
                type="source"
                position={Position.Right}
                style={{ background: LOGICAL_META.accent, width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

/**
 * The catch-all node: whatever no rule matched.
 *
 * The React Flow node type is "catchall", not "default": React Flow ships a
 * built-in type of that name whose stylesheet centres text and draws its own
 * border, and a custom type reusing the name inherits all of it.
 */
export function CatchAllNode({ data, selected }: NodeProps) {
    const { hits } = (data ?? {}) as { hits?: number };
    const t = useT();
    return (
        <NodeShell
            accent="var(--routing-default)"
            icon={MoreHorizontal}
            title={t("routing.catchAll")}
            subtitle={t("routing.catchAll.hint")}
            selected={selected}
            box={data as BoxData}
            hits={hits}
        >
            <div className="px-3.5 pb-3">
                <p className="text-[11px] text-muted-foreground">
                    {t("routing.catchAll.connect")}
                </p>
            </div>
            <Handle
                type="source"
                position={Position.Right}
                style={{ background: "var(--routing-default)", width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

export interface ActionNodeData {
    action: RoutingAction;
    /** How many sources currently feed this destination. */
    inbound: number;
    [key: string]: unknown;
}

function InboundSummary({ accent, status, inbound }: { accent: string; status: string; inbound: number }) {
    const t = useT();
    return (
        <div className="px-3.5 pb-3">
            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accent }} aria-hidden="true" />
                <span className="text-[11px] text-muted-foreground truncate">{status}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
                {inbound === 0 ? t("routing.inboundNone") : t("routing.inbound", { count: inbound })}
            </p>
        </div>
    );
}

/** A destination: everything wired into it goes here. */
export function ActionNode({ data, selected }: NodeProps) {
    const { action, inbound } = data as ActionNodeData;
    const meta = ACTION_META[action];
    const t = useT();

    return (
        <NodeShell
            accent={meta.accent}
            icon={meta.icon}
            title={t(meta.label)}
            subtitle={t(meta.hint)}
            selected={selected}
            box={data as BoxData}
        >
            <InboundSummary accent={meta.accent} status={t(meta.status)} inbound={inbound} />
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: meta.accent, width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

export interface ServerNodeData {
    /** The server's name, or undefined when it no longer exists. */
    name?: string;
    protocol?: string;
    inbound: number;
    onDelete: () => void;
    [key: string]: unknown;
}

/**
 * A specific server as a destination: traffic wired here goes through it
 * rather than the server the app is connected to.
 */
export function ServerNode({ data, selected }: NodeProps) {
    const { name, protocol, inbound, onDelete } = data as ServerNodeData;
    const t = useT();
    const accent = "var(--status-connected)";
    return (
        <NodeShell
            accent={accent}
            icon={Server}
            title={name ?? t("routing.server.gone")}
            subtitle={name ? t("routing.server.hint", { protocol: protocol ?? "" }) : t("routing.server.missing")}
            selected={selected}
            box={data as BoxData}
            onDelete={onDelete}
        >
            <InboundSummary accent={accent} status={t("routing.server.status")} inbound={inbound} />
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: accent, width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

export const NODE_TYPES = {
    source: SourceNode,
    logical: LogicalNode,
    comment: CommentNode,
    catchall: CatchAllNode,
    action: ActionNode,
    server: ServerNode,
};

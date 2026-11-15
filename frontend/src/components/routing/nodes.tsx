export { validDnsAddress } from "@/lib/dns";
import { Children, createContext, isValidElement, KeyboardEvent, useContext, useEffect, useMemo, useState } from "react";
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
import { AppPicker, useAppLabels } from "@/components/routing/app-picker";
import { isAndroid, isIOS } from "@/lib/platform";
import { MessageKey, useI18n, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RULE_GUIDE, DESTINATIONS } from "@/components/routing/guide";
import { RoutingAction, RoutingKind, RoutingSource, RuleListStatus } from "@/types";

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
        // On Android an app is its package, picked from the installed ones.
        hint: isAndroid ? "routing.source.apps.hintAndroid" : "routing.source.apps.hint",
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
/** What a protocol rule may match; the core detects these by sniffing. */
export const SNIFFABLE_PROTOCOLS = [
    "tls", "http", "quic", "bittorrent",
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
        accent: "var(--foreground)",
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

/** Shared chrome: an accent bar, an icon, a title and a subtitle. */
/** What every node gets from the canvas to be resizable. */
export interface BoxData {
    /** True once the user has resized the node. */
    sized?: boolean;
    onResize?: (box: { x: number; y: number; width: number; height: number }) => void;
    onResetSize?: () => void;
}

/**
 * Whether a node's card fills the box React Flow gives it: once it has a
 * saved size, and from the moment a resize starts. Waiting for the saved size
 * left the card at its natural width while the frame was dragged out around
 * it, and until the new size came back from settings after letting go.
 */
function useFill(box?: BoxData) {
    const [resizing, setResizing] = useState(false);
    return {
        fill: !!box?.sized || resizing,
        onResizeStart: () => setResizing(true),
        // Back to the natural size: stop filling too, or the card would stay
        // stretched to the box it no longer has.
        onResetSize: box?.onResetSize
            ? () => {
                  setResizing(false);
                  box.onResetSize?.();
              }
            : undefined,
    };
}

/**
 * The resize frame, drawn while the node is selected. Resizing from the left
 * or top moves the node as well, which onResizeEnd reports along with the size.
 */
function Resizer({
    box,
    selected,
    accent,
    minWidth,
    onResizeStart,
}: {
    box?: BoxData;
    selected?: boolean;
    accent: string;
    minWidth: number;
    onResizeStart: () => void;
}) {
    if (!box?.onResize) return null;
    return (
        <NodeResizer
            isVisible={!!selected}
            minWidth={minWidth}
            minHeight={90}
            color={accent}
            handleStyle={{ width: 9, height: 9, borderRadius: 3 }}
            onResizeStart={onResizeStart}
            onResizeEnd={(_, params) => box.onResize?.(params)}
        />
    );
}

function NodeShell({ accent, icon: Icon, title, subtitle, selected, onDelete, hits, order, wide, box, children }: {
    accent: string; icon: typeof Globe; title: string; subtitle: string; selected?: boolean;
    onDelete?: () => void; hits?: number; order?: number; wide?: boolean; box?: BoxData; children?: React.ReactNode;
}) {
    const t = useT();
    const parts = Children.toArray(children);
    const isHandle = (part: React.ReactNode) => isValidElement(part) && part.type === Handle;
    const handles = parts.filter(isHandle);
    const content = parts.filter((part) => !isHandle(part));
    const { fill, onResizeStart, onResetSize } = useFill(box);
    return <>
      <Resizer box={box} selected={selected} accent={accent} minWidth={260} onResizeStart={onResizeStart} />
      <div className={cn(fill ? "flex h-full w-full flex-col" : wide ? "w-88" : "w-80", "routing-node relative min-w-64 overflow-hidden rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow]", selected ? "border-primary/70 ring-2 ring-primary/15" : "border-border")}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
        <header className="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ color: accent, background: `color-mix(in srgb, ${accent} 12%, transparent)` }}><Icon size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{title}</span><span title={subtitle} className="mt-0.5 block truncate text-[11px] text-muted-foreground">{subtitle}</span></span>
          {order !== undefined && <span title={t("routing.ui.priority")} className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">#{order}</span>}
          {hits !== undefined && <HitsBadge count={hits} accent={accent} />}
          {box?.sized && onResetSize && <button type="button" onClick={onResetSize} aria-label={t("routing.resetSize")} className="nodrag rounded-lg p-1 text-muted-foreground hover:bg-muted"><Shrink size={12} /></button>}
          {onDelete && <button type="button" onClick={onDelete} aria-label={t("routing.remove", { name: title })} className="nodrag rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>}
        </header>
        {fill ? <div className="nowheel min-h-0 flex-1 overflow-y-auto">{content}</div> : content}
      </div>{handles}
    </>;
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
                className={cn("h-1.5 w-1.5 rounded-full", count === 0 && "opacity-40")}
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

function ValueRow({ value, detail, named, onChange, onRemove }: {
    value: string; detail?: string; named?: boolean;
    onChange: (value: string) => void; onRemove: () => void;
}) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    const [focused, setFocused] = useState(false);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        const next = draft.trim();
        if (!next) onRemove();
        else if (next !== value) onChange(next);
    };
    return (
        <div className="group flex min-w-0 items-center gap-1 rounded-xl border border-border/70 bg-muted/35 px-2 py-1">
            <div className="min-w-0 flex-1">
                <Input value={!focused && named && detail ? detail : draft}
                    onFocus={() => setFocused(true)} onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => { commit(); setFocused(false); }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setDraft(value);
                    }}
                    aria-label={t("routing.ui.edit", { name: value })} title={value}
                    spellCheck={false} dir="ltr"
                    className="nodrag h-8 min-w-0 border-0 bg-transparent! px-1 font-mono text-xs! shadow-none focus-visible:ring-0" />
                {!named && detail && <p className="truncate px-1 text-[10px] text-muted-foreground">{detail}</p>}
            </div>
            <button type="button" onClick={onRemove}
                aria-label={t("routing.remove", { name: value })}
                className="nodrag shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive">
                <Trash2 size={12} aria-hidden="true" />
            </button>
        </div>
    );
}

/** Keep large lists bounded while preserving inline editing and filtering. */
function ValueList({
    values,
    onChange,
    detail,
    named,
}: {
    values: string[];
    onChange: (values: string[]) => void;
    detail?: (value: string) => string | undefined;
    /** Entries are apps: the name leads, the path goes under it. */
    named?: boolean;
}) {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const [filter, setFilter] = useState("");

    const remove = (value: string) => onChange(values.filter((item) => item !== value));
    const row = (value: string) => (
        <ValueRow key={value} value={value} detail={detail?.(value)} named={named}
            onChange={(next) => onChange([...new Set(values.map((item) => item === value ? next : item))])}
            onRemove={() => remove(value)} />
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
export function EntryEditor({
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
    const [adding, setAdding] = useState(false);
    const listDetail = useListDetail();
    const lists = useContext(RuleListsContext);
    // Apps are picked from the installed ones: by package on Android, by
    // program on a computer, where a name can still be typed in for anything
    // the list does not have. iOS routes the whole device.
    const pickApps = kind === "apps" && !isIOS;
    const [picking, setPicking] = useState(false);
    const appLabels = useAppLabels();

    const commit = () => {
        const value = draft.trim();
        setAdding(false);
        if (!value) return;
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

    const textField = (
        <div className="flex items-center gap-1.5 pt-1">
            <Input
                autoFocus
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
    );

    return (
        <div className="space-y-1">
            {values.length > 0 && (
                <ValueList
                    values={values}
                    onChange={onChange}
                    detail={kind === "ruleset" ? listDetail : pickApps ? (value) => appLabels.get(value) : undefined}
                    named={pickApps && !isAndroid}
                />
            )}

            {pickApps ? (
                <>
                    {adding && !isAndroid ? textField : null}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPicking(true)}
                        className="nodrag mt-2 h-9 w-full gap-1.5 rounded-xl border-dashed bg-transparent text-[11px] text-muted-foreground"
                    >
                        <Plus size={12} aria-hidden="true" /> {t("apps.choose")}
                    </Button>
                    {!isAndroid && !adding && <button type="button" onClick={() => setAdding(true)}
                        className="nodrag w-full py-1 text-[10px] text-muted-foreground hover:text-foreground">
                        {t("routing.ui.manualEntry")}
                    </button>}
                    <AppPicker open={picking} values={values} onClose={() => setPicking(false)} onChange={onChange} />
                </>
            ) : choices ? (
                <ChoiceChips options={choices} values={values} onChange={onChange} />
            ) : adding ? (
                textField
            ) : (
                <button type="button" onClick={() => setAdding(true)}
                    className="nodrag mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[11px] text-muted-foreground hover:bg-muted/40">
                    <Plus size={13} aria-hidden="true" />{t("common.add")}
                </button>
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
    const { fill, onResizeStart, onResetSize } = useFill(box);

    return (
        <>
        <Resizer box={box} selected={selected} accent="var(--muted-foreground)" minWidth={160} onResizeStart={onResizeStart} />
        <div
            className={cn(
                // Resized, the text area takes whatever height the box has.
                fill ? "flex h-full w-full flex-col" : "w-60",
                "rounded-2xl border border-dashed border-border bg-card/80 shadow-none",
                selected ? "ring-2 ring-ring/50" : ""
            )}
        >
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 text-muted-foreground">
                <StickyNote size={13} aria-hidden="true" />
                <span className="flex-1 text-xs font-medium">{t("routing.note")}</span>
                {box.sized && onResetSize ? (
                    <button
                        type="button"
                        onClick={onResetSize}
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
                    fill ? "min-h-0 flex-1" : "min-h-16 [field-sizing:content]"
                )}
            />
        </div>
        </>
    );
}

interface SourceNodeData {
    kind: RoutingSource;
    values: string[];
    invert: boolean;
    hits?: number;
    order?: number;
    [key: string]: unknown;
}

/** Rules are edited directly in their cards while the handles stay connectable. */
export function SourceNode({ data, selected }: NodeProps) {
    const t = useT();
    const rule = data as SourceNodeData;
    const meta = SOURCE_META[rule.kind];
    return (
        <NodeShell accent={meta.accent} icon={meta.icon} title={t(RULE_GUIDE[rule.kind].title)}
            subtitle={t(RULE_GUIDE[rule.kind].short)} selected={selected} box={data as BoxData}
            onDelete={data.onDelete as () => void} hits={rule.hits} order={rule.order}>
            {data.content as React.ReactNode}
            <Handle type="source" position={Position.Right} title={t("routing.dragHint")}
                style={{ background: meta.accent, color: meta.accent }} />
        </NodeShell>
    );
}

export function LogicalNode({ data, selected }: NodeProps) {
    const t = useT();
    return (
        <NodeShell accent={LOGICAL_META.accent} icon={Combine} title={t("routing.source.logical")}
            subtitle={t(data.mode === "or" ? "routing.logical.any" : "routing.logical.all")}
            selected={selected} box={data as BoxData} onDelete={data.onDelete as () => void}
            hits={data.hits as number | undefined} order={data.order as number | undefined} wide>
            {data.content as React.ReactNode}
            <Handle type="source" position={Position.Right} title={t("routing.dragHint")}
                style={{ background: LOGICAL_META.accent, color: LOGICAL_META.accent }} />
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
    const t = useT();
    const { hits } = data as { hits?: number };
    return (
        <NodeShell
            accent="var(--routing-default)"
            icon={MoreHorizontal}
            title={t("routing.ui.default")}
            subtitle={t("routing.catchAll.hint")}
            selected={selected}
            box={data as BoxData}
            hits={hits}
        >
            <p className="px-4 pb-4 text-xs leading-relaxed text-muted-foreground">{t("routing.ui.defaultHint")}</p>
            <Handle
                type="source"
                position={Position.Right}
                style={{ background: "var(--routing-default)", color: "var(--routing-default)" }}
            />
        </NodeShell>
    );
}

export interface ActionNodeData {
    action: RoutingAction;
    /** How many sources currently feed this destination. */
    inbound: number;
    /** Takes the destination off the canvas; set only while nothing uses it. */
    onHide?: () => void;
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
    const { action, inbound, onHide } = data as ActionNodeData;
    const meta = ACTION_META[action];
    const t = useT();

    return (
        <NodeShell
            accent={meta.accent}
            icon={meta.icon}
            title={t(DESTINATIONS[action].title)}
            subtitle={t(DESTINATIONS[action].description)}
            selected={selected}
            box={data as BoxData}
            onDelete={onHide}
        >
            <InboundSummary accent={meta.accent} status={t(meta.status)} inbound={inbound} />
            <Handle
                type="target"
                position={Position.Left}
                style={{ background: meta.accent, color: meta.accent }}
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
                style={{ background: accent, color: accent }}
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

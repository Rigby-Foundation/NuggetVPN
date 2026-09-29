import { createContext, KeyboardEvent, useContext, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
    Ban,
    Globe2,
    Hash,
    Landmark,
    Radio,
    Regex,
    Search,
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
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RoutingAction, RoutingSource } from "@/types";

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
};

/** What a protocol rule may match; the core detects these by sniffing. */
export const SNIFFABLE_PROTOCOLS = [
    "tls", "http", "quic", "dns", "stun", "bittorrent", "dtls", "ssh", "rdp", "ntp",
] as const;

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
};

/** Shared chrome: an accent bar, an icon, a title and a subtitle. */
function NodeShell({
    accent,
    icon: Icon,
    title,
    subtitle,
    selected,
    onDelete,
    children,
}: {
    accent: string;
    icon: typeof Globe;
    title: string;
    subtitle: string;
    selected?: boolean;
    onDelete?: () => void;
    children?: React.ReactNode;
}) {
    const t = useT();
    return (
        <div
            className={cn(
                "w-64 rounded-xl border bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden",
                "transition-shadow",
                selected ? "ring-2 ring-offset-2 ring-offset-background" : ""
            )}
            style={{
                borderColor: accent,
                ...(selected ? ({ ["--tw-ring-color" as string]: accent } as object) : {}),
            }}
        >
            <div className="h-0.5 w-full" style={{ background: accent }} />

            <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-2.5">
                <span
                    className="mt-0.5 shrink-0"
                    style={{ color: accent }}
                    aria-hidden="true"
                >
                    <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-tight truncate">
                        {title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                        {subtitle}
                    </span>
                </span>
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

            {children}
        </div>
    );
}

export interface SourceNodeData {
    kind: RoutingSource;
    values: string[];
    onChange: (values: string[]) => void;
    onDelete: () => void;
    [key: string]: unknown;
}

/**
 * The protocols not yet in a rule, as chips to click.
 *
 * Protocols are a closed set — the ones the core can detect by sniffing — so
 * there is nothing to type. This used to be a text field with a <datalist>,
 * which every engine draws as a native popup that ignores the app's styling
 * entirely, and which still let you type something the backend would reject.
 */
function ProtocolChips({
    values,
    onChange,
}: {
    values: string[];
    onChange: (values: string[]) => void;
}) {
    const t = useT();
    const remaining = SNIFFABLE_PROTOCOLS.filter((protocol) => !values.includes(protocol));
    if (remaining.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-wrap gap-1 pt-1.5">
            {remaining.map((protocol) => (
                <button
                    key={protocol}
                    type="button"
                    onClick={() => onChange([...values, protocol])}
                    aria-label={t("routing.add", { name: protocol })}
                    className="nodrag flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
                >
                    <Plus size={10} aria-hidden="true" />
                    {protocol}
                </button>
            ))}
        </div>
    );
}

/** Short lists show in full; longer ones collapse to this many rows. */
const COLLAPSED_ROWS = 6;
/** The most rows an expanded list draws at once; the filter narrows the rest. */
const EXPANDED_ROWS = 100;

function ValueRow({ value, onRemove }: { value: string; onRemove: () => void }) {
    const t = useT();
    return (
        <div className="group flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
            <span className="flex-1 min-w-0 truncate font-mono text-[11px]" title={value}>
                {value}
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
function ValueList({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
    const t = useT();
    const [expanded, setExpanded] = useState(false);
    const [filter, setFilter] = useState("");

    const remove = (value: string) => onChange(values.filter((item) => item !== value));
    const needle = filter.trim().toLowerCase();
    const matches = useMemo(
        () => (needle ? values.filter((value) => value.toLowerCase().includes(needle)) : values),
        [values, needle]
    );

    if (values.length <= COLLAPSED_ROWS + 2) {
        // Not worth collapsing two rows behind a button.
        return (
            <>
                {values.map((value) => (
                    <ValueRow key={value} value={value} onRemove={() => remove(value)} />
                ))}
            </>
        );
    }

    if (!expanded) {
        return (
            <>
                {values.slice(0, COLLAPSED_ROWS).map((value) => (
                    <ValueRow key={value} value={value} onRemove={() => remove(value)} />
                ))}
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
                {shown.map((value) => (
                    <ValueRow key={value} value={value} onRemove={() => remove(value)} />
                ))}
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
    const t = useT();
    const [draft, setDraft] = useState(text);
    useEffect(() => setDraft(text), [text]);

    return (
        <div
            className={cn(
                "w-60 rounded-xl border border-dashed bg-card/85 shadow-sm backdrop-blur-sm",
                selected ? "ring-2 ring-ring/50" : ""
            )}
        >
            <div className="flex items-center gap-1.5 px-3 pt-2.5 text-muted-foreground">
                <StickyNote size={13} aria-hidden="true" />
                <span className="flex-1 text-xs font-medium">{t("routing.note")}</span>
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
                className="nodrag nowheel mt-1 block min-h-16 w-full resize-none bg-transparent px-3 pb-3 text-xs leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground/60"
            />
        </div>
    );
}

/** A traffic source: a list of entries plus an output port. */
export function SourceNode({ data, selected }: NodeProps) {
    const { kind, values, onChange, onDelete } = data as SourceNodeData;
    const meta = SOURCE_META[kind];
    const t = useT();
    const [draft, setDraft] = useState("");

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

    return (
        <NodeShell
            accent={meta.accent}
            icon={meta.icon}
            title={t(meta.label)}
            subtitle={t(meta.hint)}
            selected={selected}
            onDelete={onDelete}
        >
            <div className="px-3.5 pb-3 space-y-1">
                {values.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-1.5">
                        {t("routing.emptyRule")}
                    </p>
                ) : (
                    <ValueList values={values} onChange={onChange} />
                )}

                {kind === "protocol" ? (
                    <ProtocolChips values={values} onChange={onChange} />
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
            </div>

            <Handle
                type="source"
                position={Position.Right}
                style={{ background: meta.accent, width: 9, height: 9, border: "none" }}
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
export function CatchAllNode({ selected }: NodeProps) {
    const t = useT();
    return (
        <NodeShell
            accent="var(--routing-default)"
            icon={MoreHorizontal}
            title={t("routing.catchAll")}
            subtitle={t("routing.catchAll.hint")}
            selected={selected}
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
        >
            <div className="px-3.5 pb-3">
                <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                    <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: meta.accent }}
                        aria-hidden="true"
                    />
                    <span className="text-[11px] text-muted-foreground truncate">
                        {t(meta.status)}
                    </span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {inbound === 0 ? t("routing.inboundNone") : t("routing.inbound", { count: inbound })}
                </p>
            </div>

            <Handle
                type="target"
                position={Position.Left}
                style={{ background: meta.accent, width: 9, height: 9, border: "none" }}
            />
        </NodeShell>
    );
}

export const NODE_TYPES = {
    source: SourceNode,
    comment: CommentNode,
    catchall: CatchAllNode,
    action: ActionNode,
};

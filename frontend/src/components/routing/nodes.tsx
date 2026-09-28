import { KeyboardEvent, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
    Ban,
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
import { cn } from "@/lib/utils";
import { RoutingAction, RoutingSource } from "@/types";

/**
 * Presentation for each source kind. Colour carries meaning here — an edge is
 * drawn in its source's colour, so you can trace where a rule goes without
 * reading it.
 */
export const SOURCE_META: Record<
    RoutingSource,
    { label: string; hint: string; icon: typeof Globe; accent: string; placeholder: string }
> = {
    apps: {
        label: "Applications",
        hint: "Matched by process name",
        icon: MonitorSmartphone,
        accent: "var(--routing-apps)",
        placeholder: "Firefox.exe",
    },
    domains: {
        label: "Domains",
        hint: "Sites and subdomains",
        icon: Globe,
        accent: "var(--routing-domains)",
        placeholder: "example.com",
    },
    ip: {
        label: "IP / Networks",
        hint: "Addresses and CIDR blocks",
        icon: Network,
        accent: "var(--routing-ip)",
        placeholder: "1.1.1.0/24",
    },
};

export const ACTION_META: Record<
    RoutingAction,
    { label: string; hint: string; status: string; icon: typeof Shield; accent: string }
> = {
    proxy: {
        label: "Through the VPN",
        hint: "Encrypted in the tunnel",
        status: "Traffic is encrypted",
        icon: Shield,
        accent: "var(--status-connected)",
    },
    direct: {
        label: "Direct",
        hint: "Bypasses the tunnel",
        status: "Goes out on your own connection",
        icon: ArrowRightLeft,
        accent: "var(--routing-direct)",
    },
    block: {
        label: "Block",
        hint: "Drops the connection",
        status: "Connection is refused",
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
                        aria-label={`Remove ${title}`}
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

/** A traffic source: a list of entries plus an output port. */
export function SourceNode({ data, selected }: NodeProps) {
    const { kind, values, onChange, onDelete } = data as SourceNodeData;
    const meta = SOURCE_META[kind];
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
            title={meta.label}
            subtitle={meta.hint}
            selected={selected}
            onDelete={onDelete}
        >
            <div className="px-3.5 pb-3 space-y-1">
                {values.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground py-1.5">
                        Nothing listed yet — this rule does nothing.
                    </p>
                ) : (
                    values.map((value) => (
                        <div
                            key={value}
                            className="group flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5"
                        >
                            <span className="flex-1 min-w-0 truncate font-mono text-[11px]" title={value}>
                                {value}
                            </span>
                            <button
                                type="button"
                                onClick={() => onChange(values.filter((item) => item !== value))}
                                aria-label={`Remove ${value}`}
                                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                            >
                                <Trash2 size={12} aria-hidden="true" />
                            </button>
                        </div>
                    ))
                )}

                <div className="flex items-center gap-1.5 pt-1">
                    <Input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={commit}
                        placeholder={meta.placeholder}
                        aria-label={`Add to ${meta.label}`}
                        className="h-7 text-[11px] font-mono nodrag"
                    />
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={commit}
                        aria-label={`Add to ${meta.label}`}
                        className="h-7 w-7 shrink-0"
                    >
                        <Plus size={13} aria-hidden="true" />
                    </Button>
                </div>
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
    return (
        <NodeShell
            accent="var(--routing-default)"
            icon={MoreHorizontal}
            title="Everything else"
            subtitle="Traffic no rule matched"
            selected={selected}
        >
            <div className="px-3.5 pb-3">
                <p className="text-[11px] text-muted-foreground">
                    Connect this to choose the default.
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

    return (
        <NodeShell
            accent={meta.accent}
            icon={meta.icon}
            title={meta.label}
            subtitle={meta.hint}
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
                        {meta.status}
                    </span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {inbound === 0
                        ? "Nothing routed here."
                        : `${inbound} source${inbound === 1 ? "" : "s"} routed here.`}
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
    catchall: CatchAllNode,
    action: ActionNode,
};

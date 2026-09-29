import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Download, FileUp, Globe2, Landmark, Link2, Loader2, RefreshCw, StickyNote, Trash2, Upload } from "lucide-react";
import {
    Background,
    BackgroundVariant,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type Node,
    type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ACTION_META, GeoCodesContext, NODE_TYPES, SOURCE_META } from "@/components/routing/nodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, invoke } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
    AppSettings,
    CanvasPoint,
    FlowImport,
    GeoKind,
    RoutingAction,
    RoutingRule,
    RoutingSource,
} from "@/types";

const SOURCE_KINDS: RoutingSource[] = [
    "apps",
    "domains",
    "domain_regex",
    "ip",
    "port",
    "protocol",
    "geosite",
    "geoip",
];
const ACTIONS: RoutingAction[] = ["proxy", "direct", "block"];

/** The catch-all source node has a fixed id; destinations are keyed by action. */
const DEFAULT_NODE = "default";
const actionNodeId = (action: RoutingAction) => `action:${action}`;

/**
 * Where nodes land when the saved layout has nothing for them.
 *
 * Two columns: everything that produces traffic on the left, everywhere it can
 * go on the right, so edges all run the same direction and the graph reads left
 * to right without being untangled first.
 */
const COLUMN_GAP = 520;
// Tall enough for a source node at its largest collapsed size — six entries,
// "Show all", and the input. Nodes used to grow with every entry, so no gap
// could fit them and a long list spilled over the node below it; now that a
// long list collapses, one fixed gap does.
const SOURCE_GAP = 380;
const ACTION_GAP = 200;

function fallbackPosition(id: string, index: number): CanvasPoint {
    if (id === DEFAULT_NODE) {
        return { x: 0, y: 0 };
    }
    if (id.startsWith("action:")) {
        const slot = Math.max(0, ACTIONS.indexOf(id.slice("action:".length) as RoutingAction));
        return { x: COLUMN_GAP, y: slot * ACTION_GAP };
    }
    return { x: 0, y: 200 + index * SOURCE_GAP };
}

/** Notes stand in their own column to the left of the sources. */
const NOTE_COLUMN_X = -340;
const NOTE_GAP = 180;

/** Position for a new note: below the lowest note. */
function nextNotePosition(
    comments: { id: string }[],
    layout: Record<string, CanvasPoint>
): CanvasPoint {
    const lowest = comments.reduce(
        (bottom, comment) => Math.max(bottom, (layout[comment.id]?.y ?? 0) + NOTE_GAP),
        0
    );
    return { x: NOTE_COLUMN_X, y: lowest };
}

/** Position for a newly added source: below whatever is lowest already. */
function nextSourcePosition(
    rules: RoutingRule[],
    layout: Record<string, CanvasPoint>
): CanvasPoint {
    const lowest = rules.reduce((bottom, rule, index) => {
        const point = layout[rule.id] ?? fallbackPosition(rule.id, index);
        return Math.max(bottom, point.y);
    }, fallbackPosition(DEFAULT_NODE, 0).y);
    return { x: 0, y: lowest + SOURCE_GAP };
}

interface RoutingViewProps {
    settings: AppSettings;
    onChange: (patch: Partial<AppSettings>) => void;
}

interface CanvasProps extends RoutingViewProps {
    /** Set by the canvas so the palette outside it can move the viewport. */
    onReady: (focus: (point: CanvasPoint) => void) => void;
}

function RoutingCanvas({ settings, onChange, onReady }: CanvasProps) {
    const rules = useMemo(() => settings.routing_rules ?? [], [settings.routing_rules]);
    const layout = useMemo(() => settings.routing_layout ?? {}, [settings.routing_layout]);
    const { setCenter, getZoom } = useReactFlow();

    // The graph is derived from settings and edits are pushed back through
    // onChange. Keeping settings as the single source of truth is what lets the
    // canvas, the config generator and settings.json agree.
    const rulesRef = useRef(rules);
    rulesRef.current = rules;
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Pan to a new node rather than refitting the whole graph: fitting zooms
    // out further with every rule added, and a graph you cannot read is worse
    // than one you have to scroll.
    useEffect(() => {
        onReady((point: CanvasPoint) => {
            const zoom = Math.max(getZoom(), 0.75);
            setCenter(point.x + 128, point.y + 120, { zoom, duration: 350 });
        });
    }, [onReady, setCenter, getZoom]);

    const updateRule = useCallback(
        (id: string, patch: Partial<RoutingRule>) => {
            onChange({
                routing_rules: rulesRef.current.map((rule) =>
                    rule.id === id ? { ...rule, ...patch } : rule
                ),
            });
        },
        [onChange]
    );

    const removeRule = useCallback(
        (id: string) => {
            onChange({
                routing_rules: rulesRef.current.filter((rule) => rule.id !== id),
            });
        },
        [onChange]
    );

    const comments = useMemo(() => settings.routing_comments ?? [], [settings.routing_comments]);
    const commentsRef = useRef(comments);
    commentsRef.current = comments;

    const updateComment = useCallback(
        (id: string, text: string) => {
            onChange({
                routing_comments: commentsRef.current.map((comment) =>
                    comment.id === id ? { ...comment, text } : comment
                ),
            });
        },
        [onChange]
    );

    const removeComment = useCallback(
        (id: string) => {
            const layoutWithout = { ...layoutRef.current };
            delete layoutWithout[id];
            onChange({
                routing_comments: commentsRef.current.filter((comment) => comment.id !== id),
                routing_layout: layoutWithout,
            });
        },
        [onChange]
    );

    const inboundCounts = useMemo(() => {
        const counts: Record<string, number> = { proxy: 0, direct: 0, block: 0 };
        rules.forEach((rule) => {
            counts[rule.action] = (counts[rule.action] ?? 0) + 1;
        });
        counts[settings.default_action] = (counts[settings.default_action] ?? 0) + 1;
        return counts;
    }, [rules, settings.default_action]);

    const derivedNodes = useMemo<Node[]>(() => {
        const positioned = (id: string, index: number) =>
            layout[id] ?? fallbackPosition(id, index);

        return [
            {
                id: DEFAULT_NODE,
                type: "catchall",
                position: positioned(DEFAULT_NODE, 0),
                data: {},
            },
            ...rules.map((rule, index) => ({
                id: rule.id,
                type: "source",
                position: positioned(rule.id, index),
                data: {
                    kind: rule.kind,
                    values: rule.values ?? [],
                    onChange: (values: string[]) => updateRule(rule.id, { values }),
                    onDelete: () => removeRule(rule.id),
                },
            })),
            ...ACTIONS.map((action) => ({
                id: actionNodeId(action),
                type: "action",
                position: positioned(actionNodeId(action), 0),
                data: { action, inbound: inboundCounts[action] ?? 0 },
            })),
            ...comments.map((comment, index) => ({
                id: comment.id,
                type: "comment",
                position: layout[comment.id] ?? { x: NOTE_COLUMN_X, y: index * NOTE_GAP },
                data: {
                    text: comment.text,
                    onChange: (text: string) => updateComment(comment.id, text),
                    onDelete: () => removeComment(comment.id),
                },
            })),
        ];
    }, [rules, layout, inboundCounts, updateRule, removeRule, comments, updateComment, removeComment]);

    const derivedEdges = useMemo<Edge[]>(() => {
        const dashed = (stroke: string) => ({
            stroke,
            strokeWidth: 1.5,
            strokeDasharray: "5 5",
        });

        return [
            ...rules.map((rule) => ({
                id: `edge:${rule.id}`,
                source: rule.id,
                target: actionNodeId(rule.action),
                animated: true,
                style: dashed(SOURCE_META[rule.kind].accent),
            })),
            {
                id: "edge:default",
                source: DEFAULT_NODE,
                target: actionNodeId(settings.default_action),
                animated: true,
                style: dashed("var(--routing-default)"),
            },
        ];
    }, [rules, settings.default_action]);

    const [nodes, setNodes, onNodesChange] = useNodesState(derivedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(derivedEdges);

    useEffect(() => setNodes(derivedNodes), [derivedNodes, setNodes]);
    useEffect(() => setEdges(derivedEdges), [derivedEdges, setEdges]);

    /** Persist a node position once the drag ends, not on every frame. */
    const handleNodesChange = useCallback(
        (changes: NodeChange[]) => {
            onNodesChange(changes);

            const moved = changes.filter(
                (change) => change.type === "position" && change.dragging === false
            );
            if (moved.length === 0) {
                return;
            }
            const next = { ...layoutRef.current };
            moved.forEach((change) => {
                if (change.type !== "position" || !change.position) {
                    return;
                }
                next[change.id] = { x: change.position.x, y: change.position.y };
            });
            onChange({ routing_layout: next });
        },
        [onNodesChange, onChange]
    );

    /** Dragging an edge onto a destination is how a rule is re-pointed. */
    const onConnect = useCallback(
        (connection: Connection) => {
            const action = ACTIONS.find(
                (candidate) => actionNodeId(candidate) === connection.target
            );
            if (!action || !connection.source) {
                return;
            }
            if (connection.source === DEFAULT_NODE) {
                onChange({ default_action: action });
                return;
            }
            updateRule(connection.source, { action });
        },
        [onChange, updateRule]
    );

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.25}
            maxZoom={1.5}
            deleteKeyCode={null}
            className="bg-transparent"
        >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
        </ReactFlow>
    );
}

/**
 * The palette.
 *
 * It sits beside the canvas rather than floating over it: as a floating panel
 * it covered the destination nodes, which are exactly what you are aiming at
 * while wiring a rule up.
 */
function Palette({
    defaultAction,
    onAddSource,
    onAddNote,
    onSetDefault,
    geoPanel,
}: {
    defaultAction: RoutingAction;
    onAddSource: (kind: RoutingSource) => void;
    onAddNote: () => void;
    onSetDefault: (action: RoutingAction) => void;
    geoPanel: React.ReactNode;
}) {
    return (
        <aside className="w-56 shrink-0 rounded-xl border bg-card/60 p-2 overflow-y-auto">
            <p className="px-2 pt-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Traffic sources
            </p>
            {SOURCE_KINDS.map((kind) => {
                const meta = SOURCE_META[kind];
                return (
                    <button
                        key={kind}
                        type="button"
                        onClick={() => onAddSource(kind)}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-left"
                    >
                        <meta.icon size={15} style={{ color: meta.accent }} aria-hidden="true" />
                        <span className="truncate">{meta.label}</span>
                    </button>
                );
            })}

            <p className="px-2 pt-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Everything else
            </p>
            {ACTIONS.map((action) => {
                const meta = ACTION_META[action];
                const isDefault = defaultAction === action;
                return (
                    <button
                        key={action}
                        type="button"
                        onClick={() => onSetDefault(action)}
                        aria-pressed={isDefault}
                        title={`Send unmatched traffic: ${meta.label}`}
                        className={cn(
                            "w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-left",
                            isDefault ? "bg-accent" : "hover:bg-accent"
                        )}
                    >
                        <meta.icon size={15} style={{ color: meta.accent }} aria-hidden="true" />
                        <span className="truncate flex-1">{meta.label}</span>
                        {isDefault ? (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                                default
                            </span>
                        ) : null}
                    </button>
                );
            })}

            <p className="px-2 pt-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Canvas
            </p>
            <button
                type="button"
                onClick={onAddNote}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-left"
            >
                <StickyNote size={15} className="text-muted-foreground" aria-hidden="true" />
                <span className="truncate">Note</span>
            </button>

            {geoPanel}

            <p className="px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                Drag from a source&apos;s right edge onto a destination to change
                where it goes.
            </p>
        </aside>
    );
}

const GEO_KINDS: { kind: GeoKind; label: string; icon: typeof Globe2 }[] = [
    { kind: "geosite", label: "Services", icon: Landmark },
    { kind: "geoip", label: "Countries", icon: Globe2 },
];

/**
 * Where Service and Country rules get their lists: the built-in rule-sets, or
 * the user's own geosite.dat / geoip.dat — the files Happ and Xray clients use,
 * by path or by URL.
 */
function GeoPanel({
    settings,
    onChange,
}: {
    settings: AppSettings;
    onChange: (patch: Partial<AppSettings>) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [urlFor, setUrlFor] = useState<GeoKind | null>(null);
    const [url, setUrl] = useState("");

    const run = async (key: string, command: string, args: Record<string, unknown> = {}) => {
        setBusy(key);
        try {
            const next = await invoke<AppSettings>(command, args);
            onChange({ geo_files: next.geo_files });
            return true;
        } catch (error) {
            toast.error(errorMessage(error), { id: "geo-file" });
            return false;
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <p className="px-2 pt-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Geo data
            </p>
            <div className="space-y-2 px-1">
                {GEO_KINDS.map(({ kind, label, icon: Icon }) => {
                    const file = settings.geo_files?.[kind];
                    return (
                        <div key={kind} className="rounded-lg bg-muted/40 p-2">
                            <div className="flex items-center gap-2 text-xs">
                                <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="font-medium">{label}</span>
                            </div>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={file?.url ?? file?.name}>
                                {file
                                    ? `${file.name} · ${file.codes.toLocaleString()} codes`
                                    : "Built-in rule-sets"}
                            </p>
                            {urlFor === kind ? (
                                <form
                                    className="mt-1.5 flex gap-1"
                                    onSubmit={async (event) => {
                                        event.preventDefault();
                                        if (await run(kind, "download_geo_file", { url })) {
                                            setUrlFor(null);
                                            setUrl("");
                                        }
                                    }}
                                >
                                    <Input
                                        autoFocus
                                        value={url}
                                        onChange={(event) => setUrl(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Escape") setUrlFor(null);
                                        }}
                                        placeholder={`https://…/${kind}.dat`}
                                        aria-label={`${kind}.dat address`}
                                        className="h-7 text-[11px]"
                                    />
                                    <Button
                                        type="submit"
                                        size="icon"
                                        className="h-7 w-7 shrink-0"
                                        disabled={!url.trim() || busy !== null}
                                        aria-label="Download"
                                    >
                                        {busy === kind ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                    </Button>
                                </form>
                            ) : (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    <GeoButton
                                        icon={FileUp}
                                        label="File"
                                        disabled={busy !== null}
                                        busy={busy === kind + "-file"}
                                        onClick={() => void run(kind + "-file", "import_geo_file")}
                                    />
                                    <GeoButton icon={Link2} label="URL" disabled={busy !== null} onClick={() => setUrlFor(kind)} />
                                    {file?.source === "url" && file.url ? (
                                        <GeoButton
                                            icon={RefreshCw}
                                            label="Update"
                                            disabled={busy !== null}
                                            busy={busy === kind + "-update"}
                                            onClick={() => void run(kind + "-update", "download_geo_file", { url: file.url })}
                                        />
                                    ) : null}
                                    {file ? (
                                        <GeoButton
                                            icon={Trash2}
                                            label="Remove"
                                            disabled={busy !== null}
                                            busy={busy === kind + "-remove"}
                                            onClick={() => void run(kind + "-remove", "remove_geo_file", { kind })}
                                        />
                                    ) : null}
                                </div>
                            )}
                        </div>
                    );
                })}
                <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                    geoip.dat and geosite.dat as Happ and Xray use them. While one is loaded, its
                    codes replace the built-in ones for that kind.
                </p>
            </div>
        </>
    );
}

/** After loading a .vflow: its geo files, by the address its author used. */
function GeoOfferBanner({
    offer,
    onDone,
    onChange,
}: {
    offer: Partial<Record<GeoKind, string>>;
    onDone: (kind: GeoKind) => void;
    onChange: (patch: Partial<AppSettings>) => void;
}) {
    const [busy, setBusy] = useState<GeoKind | null>(null);
    const host = (address: string) => {
        try {
            return new URL(address).host;
        } catch {
            return address;
        }
    };
    return (
        <div className="mx-4 mb-3 space-y-1.5 rounded-xl border bg-card/60 px-3 py-2.5">
            {(Object.entries(offer) as [GeoKind, string][]).map(([kind, address]) => (
                <div key={kind} className="flex items-center gap-3 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                        This routing uses a {kind}.dat from{" "}
                        <span className="font-mono text-muted-foreground" title={address}>
                            {host(address)}
                        </span>
                    </span>
                    <Button
                        size="sm"
                        className="h-7 gap-1.5"
                        disabled={busy !== null}
                        onClick={async () => {
                            setBusy(kind);
                            try {
                                const next = await invoke<AppSettings>("download_geo_file", { url: address });
                                onChange({ geo_files: next.geo_files });
                                onDone(kind);
                            } catch (error) {
                                toast.error(errorMessage(error), { id: "geo-file" });
                            } finally {
                                setBusy(null);
                            }
                        }}
                    >
                        {busy === kind ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        Download
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => onDone(kind)}>
                        Skip
                    </Button>
                </div>
            ))}
        </div>
    );
}

function GeoButton({
    icon: Icon,
    label,
    onClick,
    disabled,
    busy,
}: {
    icon: typeof Globe2;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
        >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} aria-hidden="true" />}
            {label}
        </button>
    );
}

function RoutingView({ settings, onChange }: RoutingViewProps) {
    const rules = settings.routing_rules ?? [];
    const defaultLabel = (
        ACTION_META[settings.default_action]?.label ?? "Through the VPN"
    ).toLowerCase();

    // Codes from the user's own geo files, for suggestions in the nodes.
    // Reloaded whenever a file is added, replaced or removed.
    const [geoCodes, setGeoCodes] = useState<Partial<Record<GeoKind, string[]>>>({});
    const geoSignature = JSON.stringify(settings.geo_files ?? {});
    useEffect(() => {
        let cancelled = false;
        void Promise.all(
            GEO_KINDS.map(async ({ kind }) =>
                [kind, settings.geo_files?.[kind] ? await invoke<string[]>("get_geo_codes", { kind }) : []] as const
            )
        )
            .then((entries) => {
                if (!cancelled) setGeoCodes(Object.fromEntries(entries));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geoSignature]);

    // A routing file refers to geo files by URL; offered, not fetched.
    const [geoOffer, setGeoOffer] = useState<Partial<Record<GeoKind, string>>>({});

    const exportRouting = useCallback(async () => {
        try {
            const path = await invoke<string>("export_routing");
            if (path) toast.success(`Routing saved to ${path.split(/[\\/]/).pop()}`);
        } catch (error) {
            toast.error(`Could not save the routing: ${errorMessage(error)}`);
        }
    }, []);

    const importRouting = useCallback(async () => {
        // Kept so the import can be undone: it replaces the whole graph.
        const previous: Partial<AppSettings> = {
            routing_rules: settings.routing_rules,
            default_action: settings.default_action,
            routing_layout: settings.routing_layout,
            routing_comments: settings.routing_comments,
        };
        try {
            const result = await invoke<FlowImport>("import_routing");
            if (!result.imported) return;
            onChange({
                routing_rules: result.settings.routing_rules,
                default_action: result.settings.default_action,
                routing_layout: result.settings.routing_layout,
                routing_comments: result.settings.routing_comments,
            });
            setGeoOffer(result.missing_geo ?? {});
            toast(
                (shown) => (
                    <span className="flex items-center gap-3 text-sm">
                        Routing loaded.
                        <button
                            type="button"
                            className="font-medium text-primary"
                            onClick={() => {
                                onChange(previous);
                                setGeoOffer({});
                                toast.dismiss(shown.id);
                            }}
                        >
                            Undo
                        </button>
                    </span>
                ),
                { id: "routing-import", duration: 8000 }
            );
        } catch (error) {
            toast.error(errorMessage(error), { id: "routing-import" });
        }
    }, [onChange, settings]);

    // The canvas hands back a focuser so adding a node from the palette brings
    // it into view instead of dropping it below the fold.
    const focusRef = useRef<((point: CanvasPoint) => void) | null>(null);
    const handleReady = useCallback((focus: (point: CanvasPoint) => void) => {
        focusRef.current = focus;
    }, []);

    const addNote = useCallback(() => {
        const id = `note-${Date.now().toString(36)}`;
        const layout = settings.routing_layout ?? {};
        const comments = settings.routing_comments ?? [];
        const position = nextNotePosition(comments, layout);
        onChange({
            routing_comments: [...comments, { id, text: "" }],
            routing_layout: { ...layout, [id]: position },
        });
        setTimeout(() => focusRef.current?.(position), 60);
    }, [onChange, settings.routing_comments, settings.routing_layout]);

    const addSource = useCallback(
        (kind: RoutingSource) => {
            const id = `${kind}-${Date.now().toString(36)}`;
            const layout = settings.routing_layout ?? {};
            const position = nextSourcePosition(rules, layout);

            onChange({
                routing_rules: [...rules, { id, kind, values: [], action: "proxy" }],
                routing_layout: { ...layout, [id]: position },
            });
            // Once the node exists, not during this render.
            setTimeout(() => focusRef.current?.(position), 60);
        },
        [onChange, rules, settings.routing_layout]
    );

    return (
        <div className="enter-stagger absolute inset-0 flex flex-col">
            <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 shrink-0">
                <div className="min-w-0">
                    <h1 className="text-base font-semibold tracking-tight">Routing</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {rules.length === 0
                            ? `No rules — everything goes ${defaultLabel}.`
                            : `${rules.length} rule${rules.length === 1 ? "" : "s"}; everything else goes ${defaultLabel}.`}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void importRouting()}>
                        <Upload size={14} aria-hidden="true" /> Import
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void exportRouting()}>
                        <Download size={14} aria-hidden="true" /> Export
                    </Button>
                    {rules.length > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => onChange({ routing_rules: [] })}>
                            Clear rules
                        </Button>
                    ) : null}
                </div>
            </header>

            {Object.keys(geoOffer).length > 0 ? (
                <GeoOfferBanner
                    offer={geoOffer}
                    onDone={(kind) =>
                        setGeoOffer((current) => {
                            const next = { ...current };
                            delete next[kind];
                            return next;
                        })
                    }
                    onChange={onChange}
                />
            ) : null}

            <div className="flex-1 min-h-0 mx-4 mb-4 flex gap-3">
                <div className="flex-1 min-w-0 rounded-xl border overflow-hidden">
                    <GeoCodesContext.Provider value={geoCodes}>
                        <ReactFlowProvider>
                            <RoutingCanvas
                                settings={settings}
                                onChange={onChange}
                                onReady={handleReady}
                            />
                        </ReactFlowProvider>
                    </GeoCodesContext.Provider>
                </div>
                <Palette
                    defaultAction={settings.default_action}
                    onAddSource={addSource}
                    onAddNote={addNote}
                    onSetDefault={(action) => onChange({ default_action: action })}
                    geoPanel={<GeoPanel settings={settings} onChange={onChange} />}
                />
            </div>
        </div>
    );
}

export default RoutingView;

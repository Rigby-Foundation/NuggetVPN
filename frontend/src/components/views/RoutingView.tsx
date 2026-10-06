import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Download, FileUp, Globe2, Info, Landmark, Link2, Loader2, Redo2, RefreshCw, Server, StickyNote, Trash2, Puzzle, Undo2, Upload, Plus } from "lucide-react";
import {
    Background,
    BackgroundVariant,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useStore,
    type Connection,
    type Edge,
    type Node,
    type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
    ACTION_META,
    GeoCodesContext,
    kindMeta,
    NODE_TYPES,
    RuleListsContext,
    RulePatch,
} from "@/components/routing/nodes";
import { RuleOrder } from "@/components/routing/order";
import { usePlugins } from "@/components/plugins/plugins-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { PresetList, PresetPlacement, PresetRule } from "@/components/routing/presets";
import { SetupSwitcher } from "@/components/routing/setups";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, invoke } from "@/lib/backend";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
    AppSettings,
    CanvasPoint,
    FlowImport,
    GeoKind,
    Profile,
    RoutingAction,
    RoutingKind,
    RoutingRule,
    RuleListStatus,
} from "@/types";
import { usePageVisible } from "@/hooks/use-page-visible";

// Domain patterns are added as a domains card, switched to patterns there.
const SOURCE_KINDS: RoutingKind[] = [
    "apps",
    "domains",
    "ip",
    "port",
    "protocol",
    "network",
    "geosite",
    "geoip",
    "ruleset",
    "logical",
];
const ACTIONS: RoutingAction[] = ["proxy", "direct", "block", "drop"];

/**
 * Destinations that can be taken off the canvas while nothing goes to them:
 * many setups never block or drop anything, and the two cards only take room.
 * Which ones are hidden is how this device shows the canvas, not part of the
 * routing, so it is kept here rather than in the settings.
 */
const HIDEABLE_ACTIONS: RoutingAction[] = ["block", "drop"];
const HIDDEN_ACTIONS_KEY = "nugget.routing.hiddenActions";

function useHiddenActions() {
    const [hidden, setHidden] = useState<RoutingAction[]>(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(HIDDEN_ACTIONS_KEY) ?? "[]");
            return Array.isArray(saved) ? saved.filter((action) => HIDEABLE_ACTIONS.includes(action)) : [];
        } catch {
            return [];
        }
    });
    const update = useCallback((next: RoutingAction[]) => {
        setHidden(next);
        try {
            localStorage.setItem(HIDDEN_ACTIONS_KEY, JSON.stringify(next));
        } catch {
            // Not remembered; the canvas still works.
        }
    }, []);
    const hide = useCallback((action: RoutingAction) => update([...hidden.filter((item) => item !== action), action]), [hidden, update]);
    const show = useCallback((action: RoutingAction) => update(hidden.filter((item) => item !== action)), [hidden, update]);
    return { hidden, hide, show };
}

/** A small "i" that shows an explanation on hover, focus or click. */
function InfoTip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    return (
        <Tooltip open={open} onOpenChange={setOpen}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-label={text}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                    <Info size={12} aria-hidden="true" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60 text-[11px] leading-relaxed">
                {text}
            </TooltipContent>
        </Tooltip>
    );
}

/** The catch-all source node has a fixed id; destinations are keyed by action. */
const DEFAULT_NODE = "default";
const actionNodeId = (action: RoutingAction) => `action:${action}`;
/** A server destination is keyed by the profile it sends traffic through. */
const SERVER_PREFIX = "server:";
const serverNodeId = (profileId: string) => `${SERVER_PREFIX}${profileId}`;

/** The node a rule's edge ends at: a server of its own, or its action. */
function targetOf(action: RoutingAction, server: string | undefined) {
    return action === "proxy" && server ? serverNodeId(server) : actionNodeId(action);
}

/** How often live connection counts are read while connected. */
const HITS_INTERVAL_MS = 2000;
/** GetRuleHits' key for traffic no rule matched; see app.DefaultRuleHits. */
const DEFAULT_HITS = "__default";

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
    if (id.startsWith(SERVER_PREFIX)) {
        // Below the fixed destinations, in the order they were added.
        return { x: COLUMN_GAP, y: (ACTIONS.length + index) * ACTION_GAP };
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
    /** Takes settings the backend already saved, such as after a setup switch. */
    onReplace: (settings: AppSettings) => void;
    profiles: Profile[];
    connected: boolean;
}

interface CanvasProps {
    settings: AppSettings;
    /** Destinations taken off the canvas; any that something uses still shows. */
    hiddenActions: RoutingAction[];
    onHideAction: (action: RoutingAction) => void;
    onChange: (patch: Partial<AppSettings>) => void;
    profiles: Profile[];
    /** Open connections by rule id; null while disconnected. */
    hits: Record<string, number> | null;
    /** Set by the canvas so the palette outside it can move the viewport. */
    onReady: (focus: (point: CanvasPoint) => void) => void;
}

/** The server destinations on the canvas: those placed, plus any a rule uses. */
function serverIds(settings: AppSettings): string[] {
    const ids = [...(settings.routing_servers ?? [])];
    const add = (id: string | undefined) => {
        if (id && !ids.includes(id)) ids.push(id);
    };
    (settings.routing_rules ?? []).forEach((rule) => {
        if (rule.action === "proxy") add(rule.server);
    });
    if (settings.default_action === "proxy") add(settings.default_server);
    return ids;
}

function RoutingCanvas({ settings, hiddenActions, onHideAction, onChange, profiles, hits, onReady }: CanvasProps) {
    const t = useT();
    const rules = useMemo(() => settings.routing_rules ?? [], [settings.routing_rules]);
    const layout = useMemo(() => settings.routing_layout ?? {}, [settings.routing_layout]);
    const { setCenter, getZoom, fitView } = useReactFlow();
    // The zoom, for CSS: a connector's catch area stays the same size on
    // screen however far the canvas is zoomed out. See App.css.
    const zoom = useStore((state) => state.transform[2]);

    // The whole graph is fitted on first sight, and again whenever the canvas
    // changes size — the window resized, or the phone layout replacing the
    // side panel — until the user pans or zooms, after which their view is
    // theirs.
    const wrapperRef = useRef<HTMLDivElement>(null);
    const userMovedRef = useRef(false);
    useEffect(() => {
        const element = wrapperRef.current;
        if (!element || typeof ResizeObserver !== "function") return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            if (userMovedRef.current) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => void fitView({ padding: 0.15 }));
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [fitView]);

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

    const servers = useMemo(() => serverIds(settings), [settings]);
    const serversRef = useRef(servers);
    serversRef.current = servers;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    // Taking a server off the canvas sends what went through it back to the
    // connected server, rather than leaving rules pointing at nothing.
    const removeServer = useCallback(
        (profileId: string) => {
            const current = settingsRef.current;
            const layoutWithout = { ...layoutRef.current };
            delete layoutWithout[serverNodeId(profileId)];
            onChange({
                routing_servers: serversRef.current.filter((id) => id !== profileId),
                routing_rules: rulesRef.current.map((rule) =>
                    rule.server === profileId ? { ...rule, server: "" } : rule
                ),
                default_server: current.default_server === profileId ? "" : current.default_server,
                routing_layout: layoutWithout,
            });
        },
        [onChange]
    );

    const inboundCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        rules.forEach((rule) => {
            if (rule.action) {
                const target = targetOf(rule.action, rule.server);
                counts[target] = (counts[target] ?? 0) + 1;
            }
        });
        if (settings.default_action) {
            const target = targetOf(settings.default_action, settings.default_server);
            counts[target] = (counts[target] ?? 0) + 1;
        }
        return counts;
    }, [rules, settings.default_action, settings.default_server]);

    /** Saves a node's new size, and its position, which moves when resized from the left or top. */
    const resizeNode = useCallback(
        (id: string, box: { x: number; y: number; width: number; height: number }) => {
            onChange({
                routing_layout: {
                    ...layoutRef.current,
                    [id]: {
                        x: box.x,
                        y: box.y,
                        width: Math.round(box.width),
                        height: Math.round(box.height),
                    },
                },
            });
        },
        [onChange]
    );

    /** Back to the node's natural size, keeping where it is. */
    const resetNodeSize = useCallback(
        (id: string) => {
            const point = layoutRef.current[id];
            if (!point) return;
            onChange({ routing_layout: { ...layoutRef.current, [id]: { x: point.x, y: point.y } } });
        },
        [onChange]
    );

    const derivedNodes = useMemo<Node[]>(() => {
        const positioned = (id: string, index: number) => {
            const point = layout[id] ?? fallbackPosition(id, index);
            return { x: point.x, y: point.y };
        };
        const hitsFor = (id: string) => (hits ? hits[id] ?? 0 : undefined);

        return [
            {
                id: DEFAULT_NODE,
                type: "catchall",
                position: positioned(DEFAULT_NODE, 0),
                data: { hits: hitsFor(DEFAULT_HITS) },
            },
            ...rules.map((rule, index) => ({
                id: rule.id,
                type: rule.kind === "logical" ? "logical" : "source",
                position: positioned(rule.id, index),
                data: {
                    kind: rule.kind,
                    values: rule.values ?? [],
                    mode: rule.mode ?? "and",
                    conditions: rule.conditions ?? [],
                    action: rule.action,
                    invert: !!rule.invert,
                    dns: rule.dns ?? "",
                    hits: hitsFor(rule.id),
                    order: index + 1,
                    onChange: (patch: RulePatch) => updateRule(rule.id, patch),
                    onDelete: () => removeRule(rule.id),
                },
            })),
            ...ACTIONS.flatMap((action) => {
                const inbound = inboundCounts[actionNodeId(action)] ?? 0;
                // Something going there keeps it on the canvas, hidden or not.
                if (inbound === 0 && hiddenActions.includes(action)) return [];
                const hideable = inbound === 0 && HIDEABLE_ACTIONS.includes(action);
                return [{
                    id: actionNodeId(action),
                    type: "action",
                    position: positioned(actionNodeId(action), 0),
                    data: { action, inbound, onHide: hideable ? () => onHideAction(action) : undefined },
                }];
            }),
            ...servers.map((profileId, index) => {
                const profile = profiles.find((item) => item.id === profileId);
                return {
                    id: serverNodeId(profileId),
                    type: "server",
                    position: positioned(serverNodeId(profileId), index),
                    data: {
                        name: profile?.name,
                        protocol: profile?.protocol,
                        inbound: inboundCounts[serverNodeId(profileId)] ?? 0,
                        onDelete: () => removeServer(profileId),
                    },
                };
            }),
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
        ].map((node): Node => {
            // Every node can be resized; a resized one keeps its size.
            const box = layout[node.id];
            const sized = !!box?.width && !!box?.height;
            return {
                ...node,
                ...(sized ? { width: box.width, height: box.height } : {}),
                data: {
                    ...node.data,
                    sized,
                    onResize: (next: { x: number; y: number; width: number; height: number }) => resizeNode(node.id, next),
                    onResetSize: () => resetNodeSize(node.id),
                },
            };
        });
    }, [rules, layout, inboundCounts, hiddenActions, onHideAction, updateRule, removeRule, comments, updateComment, removeComment, servers, profiles, removeServer, hits, resizeNode, resetNodeSize]);

    const derivedEdges = useMemo<Edge[]>(() => {
        // An edge carrying connections right now is drawn heavier, so the
        // routes in use stand out from the ones merely configured.
        const dashed = (stroke: string, active: boolean) => ({
            stroke,
            strokeWidth: active ? 2.5 : 1.5,
            strokeDasharray: "5 5",
        });
        const active = (id: string) => (hits?.[id] ?? 0) > 0;

        const ruleEdges: Edge[] = rules
            .filter((rule) => !!rule.action)
            .map((rule) => ({
                id: `edge:${rule.id}`,
                source: rule.id,
                target: targetOf(rule.action, rule.server),
                animated: true,
                style: dashed(kindMeta(rule.kind).accent, active(rule.id)),
            }));

        const defaultEdge: Edge[] = settings.default_action
            ? [
                  {
                      id: "edge:default",
                      source: DEFAULT_NODE,
                      target: targetOf(settings.default_action, settings.default_server),
                      animated: true,
                      style: dashed("var(--routing-default)", active(DEFAULT_HITS)),
                      deletable: false,
                      data: { deletable: false },
                  },
              ]
            : [];

        return [...ruleEdges, ...defaultEdge];
    }, [rules, settings.default_action, settings.default_server, hits]);

    const [nodes, setNodes, onNodesChange] = useNodesState(derivedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(derivedEdges);

    // Nodes are rebuilt whenever settings change and, while connected, every
    // time the live counts arrive. What React Flow tracks itself — a drag in
    // progress, the selection, measured sizes — carries over, or a node being
    // dragged would jump back every two seconds.
    useEffect(
        () =>
            setNodes((current) => {
                const previous = new Map(current.map((node) => [node.id, node]));
                return derivedNodes.map((node) => {
                    const before = previous.get(node.id);
                    if (!before) return node;
                    // Mid-resize, the size React Flow is drawing wins over
                    // the saved one, which only updates when the resize ends.
                    const resizing = !!before.resizing;
                    return {
                        ...node,
                        position: before.dragging || resizing ? before.position : node.position,
                        ...(resizing ? { width: before.width, height: before.height } : {}),
                        dragging: before.dragging,
                        resizing: before.resizing,
                        selected: before.selected,
                        measured: before.measured,
                    };
                });
            }),
        [derivedNodes, setNodes]
    );
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
                // Moving keeps a resized node's size.
                next[change.id] = { ...next[change.id], x: change.position.x, y: change.position.y };
            });
            onChange({ routing_layout: next });
        },
        [onNodesChange, onChange]
    );

    /** Dragging an edge onto a destination is how a rule is re-pointed. */
    const onConnect = useCallback(
        (connection: Connection) => {
            if (!connection.source || !connection.target) {
                return;
            }
            let action = ACTIONS.find((candidate) => actionNodeId(candidate) === connection.target);
            let server = "";
            if (connection.target.startsWith(SERVER_PREFIX)) {
                action = "proxy";
                server = connection.target.slice(SERVER_PREFIX.length);
            }
            if (!action) {
                return;
            }
            if (connection.source === DEFAULT_NODE) {
                onChange({ default_action: action, default_server: server });
                return;
            }
            updateRule(connection.source, { action, server });
        },
        [onChange, updateRule]
    );

    /** Clicking an edge with scissors cuts that connection. */
    const onEdgeClick = useCallback(
        (event: React.MouseEvent, edge: Edge) => {
            event.stopPropagation();
            const undeletable =
                edge.id === "edge:default" ||
                edge.source === DEFAULT_NODE ||
                edge.deletable === false ||
                (edge.data as Record<string, unknown> | undefined)?.deletable === false;

            if (undeletable) {
                const message =
                    edge.id === "edge:default" || edge.source === DEFAULT_NODE
                        ? t("routing.cannotDeleteDefault")
                        : t("routing.cannotDeleteConnection");
                toast(message, { icon: "⚠️", id: "cannot-delete-connection" });
                return;
            }

            const ruleId = edge.id.startsWith("edge:") ? edge.id.slice("edge:".length) : edge.source;
            updateRule(ruleId, { action: "" as RoutingAction, server: "" });
        },
        [updateRule, t]
    );

    return (
        <div ref={wrapperRef} className="h-full w-full" style={{ ["--flow-zoom" as string]: zoom }}>
        <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onMoveStart={(event) => {
                // Only a gesture has an event; programmatic moves do not.
                if (event) userMovedRef.current = true;
            }}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            // A dragged wire snaps to a connector this far away.
            connectionRadius={40}
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
        </div>
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
    onAddServer,
    onAddPreset,
    hiddenActions,
    onShowAction,
    profiles,
    placedServers,
    geoPanel,
    orderPanel,
    className,
}: {
    defaultAction: RoutingAction;
    onAddSource: (kind: RoutingKind) => void;
    onAddNote: () => void;
    onSetDefault: (action: RoutingAction) => void;
    onAddServer: (profileId: string) => void;
    onAddPreset: (rules: PresetRule[], placement: PresetPlacement) => void;
    /** Hidden destinations nothing uses, offered here to put back. */
    hiddenActions: RoutingAction[];
    onShowAction: (action: RoutingAction) => void;
    profiles: Profile[];
    placedServers: string[];
    geoPanel: React.ReactNode;
    orderPanel: React.ReactNode;
    className?: string;
}) {
    const t = useT();
    const [tab, setTab] = useState<"add" | "order">("add");
    const available = profiles.filter((profile) => !placedServers.includes(profile.id));
    return (
        <aside className={cn("w-60 shrink-0 rounded-xl border bg-card/60 p-2 overflow-y-auto", className)}>
            <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-muted/60 p-0.5" role="tablist">
                {(["add", "order"] as const).map((option) => (
                    <button
                        key={option}
                        type="button"
                        role="tab"
                        aria-selected={tab === option}
                        onClick={() => setTab(option)}
                        className={cn(
                            "rounded-md py-1 text-xs transition-colors",
                            tab === option ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t(option === "add" ? "routing.tab.add" : "routing.tab.order")}
                    </button>
                ))}
            </div>
            {tab === "order" ? orderPanel : (
            <>
            <p className="flex items-center gap-1 px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
                <span className="flex-1">{t("routing.sources")}</span>
                <InfoTip text={t("routing.dragHint")} />
            </p>
            {SOURCE_KINDS.map((kind) => {
                const meta = kindMeta(kind);
                return (
                    <button
                        key={kind}
                        type="button"
                        onClick={() => onAddSource(kind)}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-start"
                    >
                        <meta.icon size={15} style={{ color: meta.accent }} aria-hidden="true" />
                        <span className="truncate">{t(meta.label)}</span>
                    </button>
                );
            })}

            <p className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">
                {t("routing.catchAll")}
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
                        title={t("routing.sendUnmatched", { action: t(meta.label) })}
                        className={cn(
                            "w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-start",
                            isDefault ? "bg-accent" : "hover:bg-accent"
                        )}
                    >
                        <meta.icon size={15} style={{ color: meta.accent }} aria-hidden="true" />
                        <span className="truncate flex-1">{t(meta.label)}</span>
                        {isDefault ? (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                                {t("routing.default")}
                            </span>
                        ) : null}
                    </button>
                );
            })}

            <p className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">
                {t("routing.destinations")}
            </p>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        disabled={available.length === 0}
                        title={available.length === 0 ? t("routing.server.none") : t("routing.server.addHint")}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-start disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                        <Server size={15} style={{ color: "var(--status-connected)" }} aria-hidden="true" />
                        <span className="truncate">{t("routing.server.add")}</span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="left" className="w-64 max-h-80 overflow-y-auto">
                    {available.map((profile) => (
                        <DropdownMenuItem key={profile.id} className="text-xs gap-2" onClick={() => onAddServer(profile.id)}>
                            <span className="truncate">{profile.name}</span>
                            <span className="ms-auto shrink-0 text-muted-foreground">{profile.protocol}</span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            {hiddenActions.map((action) => {
                const meta = ACTION_META[action];
                return (
                    <button
                        key={action}
                        type="button"
                        onClick={() => onShowAction(action)}
                        title={t("routing.action.show")}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-start"
                    >
                        <meta.icon size={15} style={{ color: meta.accent }} aria-hidden="true" />
                        <span className="truncate">{t(meta.label)}</span>
                    </button>
                );
            })}

            <PresetList onAdd={onAddPreset} />

            <p className="px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">
                {t("routing.canvas")}
            </p>
            <button
                type="button"
                onClick={onAddNote}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-accent text-start"
            >
                <StickyNote size={15} className="text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{t("routing.note")}</span>
            </button>

            {geoPanel}
            </>
            )}
        </aside>
    );
}

const GEO_KINDS: { kind: GeoKind; label: MessageKey; icon: typeof Globe2 }[] = [
    { kind: "geosite", label: "routing.geo.services", icon: Landmark },
    { kind: "geoip", label: "routing.geo.countries", icon: Globe2 },
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
    const t = useT();
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
            <p className="flex items-center gap-1 px-2 pt-3 pb-2 text-xs font-medium text-muted-foreground">
                <span className="flex-1">{t("routing.geo.title")}</span>
                <InfoTip text={t("routing.geo.explain")} />
            </p>
            <div className="space-y-2 px-1">
                {GEO_KINDS.map(({ kind, label, icon: Icon }) => {
                    const file = settings.geo_files?.[kind];
                    return (
                        <div key={kind} className="rounded-lg bg-muted/40 p-2">
                            <div className="flex items-center gap-2 text-xs">
                                <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="font-medium">{t(label)}</span>
                            </div>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={file?.url ?? file?.name}>
                                {file
                                    ? t("routing.geo.file", { name: file.name, count: file.codes })
                                    : t("routing.geo.builtIn")}
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
                                        aria-label={t("routing.geo.address", { file: `${kind}.dat` })}
                                        className="h-7 text-[11px]"
                                    />
                                    <Button
                                        type="submit"
                                        size="icon"
                                        className="h-7 w-7 shrink-0"
                                        disabled={!url.trim() || busy !== null}
                                        aria-label={t("routing.geo.download")}
                                    >
                                        {busy === kind ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                    </Button>
                                </form>
                            ) : (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    <GeoButton
                                        icon={FileUp}
                                        label={t("routing.geo.fromFile")}
                                        disabled={busy !== null}
                                        busy={busy === kind + "-file"}
                                        onClick={() => void run(kind + "-file", "import_geo_file")}
                                    />
                                    <GeoButton icon={Link2} label={t("routing.geo.fromUrl")} disabled={busy !== null} onClick={() => setUrlFor(kind)} />
                                    {file?.source === "url" && file.url ? (
                                        <GeoButton
                                            icon={RefreshCw}
                                            label={t("routing.geo.update")}
                                            disabled={busy !== null}
                                            busy={busy === kind + "-update"}
                                            onClick={() => void run(kind + "-update", "download_geo_file", { url: file.url })}
                                        />
                                    ) : null}
                                    {file ? (
                                        <GeoButton
                                            icon={Trash2}
                                            label={t("routing.geo.remove")}
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
    const t = useT();
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
                        {t("routing.geo.offer", { file: `${kind}.dat` })}{" "}
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
                        {t("routing.geo.download")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => onDone(kind)}>
                        {t("routing.geo.skip")}
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

/** The settings that make up the routing graph: what undo puts back. */
const GRAPH_KEYS = [
    "routing_rules",
    "routing_layout",
    "routing_comments",
    "default_action",
    "default_server",
    "routing_servers",
] as const;
type GraphSnapshot = Pick<AppSettings, (typeof GRAPH_KEYS)[number]>;
/** How many steps back undo can go. */
const HISTORY_LIMIT = 100;

function RoutingView({ settings, onChange: save, onReplace, profiles, connected }: RoutingViewProps) {
    const t = useT();

    // Undo and redo. Every change to the graph passes through onChange below,
    // which records the graph as it was; undo puts it back. Changes to
    // anything else — the geo files — are not steps.
    const settingsNow = useRef(settings);
    settingsNow.current = settings;
    const history = useRef<{ past: GraphSnapshot[]; future: GraphSnapshot[] }>({ past: [], future: [] });
    const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
    const syncHistory = () =>
        setHistorySize({ past: history.current.past.length, future: history.current.future.length });
    const snapshot = (): GraphSnapshot => {
        const current = settingsNow.current;
        return Object.fromEntries(GRAPH_KEYS.map((key) => [key, current[key]])) as GraphSnapshot;
    };
    const onChange = useCallback(
        (patch: Partial<AppSettings>) => {
            if (Object.keys(patch).some((key) => (GRAPH_KEYS as readonly string[]).includes(key))) {
                history.current.past.push(snapshot());
                if (history.current.past.length > HISTORY_LIMIT) history.current.past.shift();
                history.current.future = [];
                syncHistory();
            }
            save(patch);
        },
        // snapshot reads a ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [save]
    );
    const undo = useCallback(() => {
        const previous = history.current.past.pop();
        if (!previous) return;
        history.current.future.push(snapshot());
        syncHistory();
        save(previous);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [save]);
    const redo = useCallback(() => {
        const next = history.current.future.pop();
        if (!next) return;
        history.current.past.push(snapshot());
        syncHistory();
        save(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [save]);
    // Another setup is another graph; its history is not this one's.
    useEffect(() => {
        history.current = { past: [], future: [] };
        syncHistory();
    }, [settings.active_routing_setup]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            // Inside a text field the keys undo the typing, as everywhere.
            if (target?.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) {
                event.preventDefault();
                undo();
            } else if ((key === "z" && event.shiftKey) || key === "y") {
                event.preventDefault();
                redo();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [undo, redo]);
    const rules = settings.routing_rules ?? [];

    // Live connection counts, while connected and on screen.
    const [hits, setHits] = useState<Record<string, number> | null>(null);
    const visible = usePageVisible();
    useEffect(() => {
        if (!connected) {
            setHits(null);
            return;
        }
        if (!visible) return;
        let cancelled = false;
        const read = () =>
            invoke<Record<string, number>>("get_rule_hits")
                .then((next) => {
                    if (!cancelled) setHits(next ?? {});
                })
                .catch(() => undefined);
        void read();
        const timer = window.setInterval(read, HITS_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [connected, visible]);

    // What is known about each rule list, reloaded when the URLs change.
    const [lists, setLists] = useState<Record<string, RuleListStatus>>({});
    const [updatingLists, setUpdatingLists] = useState(false);
    const listSignature = JSON.stringify(
        rules.flatMap((rule) => [
            ...(rule.kind === "ruleset" ? rule.values ?? [] : []),
            ...(rule.conditions ?? []).filter((condition) => condition.kind === "ruleset").flatMap((condition) => condition.values ?? []),
        ])
    );
    const storeLists = (statuses: RuleListStatus[] | null) =>
        setLists(Object.fromEntries((statuses ?? []).map((status) => [status.url, status])));
    useEffect(() => {
        // Read after the save carrying the new URLs has landed.
        const timer = window.setTimeout(() => {
            invoke<RuleListStatus[]>("get_rule_lists").then(storeLists).catch(() => undefined);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [listSignature]);
    const updateLists = useCallback(async () => {
        setUpdatingLists(true);
        try {
            storeLists(await invoke<RuleListStatus[]>("update_rule_lists"));
            toast.success(t("routing.list.updated"), { id: "rule-lists" });
        } catch (error) {
            toast.error(errorMessage(error), { id: "rule-lists" });
        } finally {
            setUpdatingLists(false);
        }
    }, [t]);
    const listsContext = useMemo(
        () => ({ lists, updating: updatingLists, update: () => void updateLists() }),
        [lists, updatingLists, updateLists]
    );
    const defaultLabel = t(ACTION_META[settings.default_action]?.label ?? "routing.action.proxy");

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
            if (path) toast.success(t("routing.saved", { file: path.split(/[\\/]/).pop() ?? path }));
        } catch (error) {
            toast.error(t("routing.saveFailed", { error: errorMessage(error) }));
        }
    }, [t]);

    const { plugins } = usePlugins();
    const isMobile = useIsMobile();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const hiddenActions = useHiddenActions();
    // A hidden destination something goes to is on the canvas regardless.
    const offeredActions = hiddenActions.hidden.filter(
        (action) => action !== settings.default_action && !rules.some((rule) => rule.action === action)
    );
    const pluginSetups = plugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) => plugin.routing.map((setup) => ({ plugin, setup })));

    // A .vflow from a file, or one a plugin brings.
    const importRouting = useCallback(async (load: () => Promise<FlowImport> = () => invoke<FlowImport>("import_routing")) => {
        // Kept so the import can be undone: it replaces the whole graph.
        const previous: Partial<AppSettings> = {
            routing_rules: settings.routing_rules,
            default_action: settings.default_action,
            default_server: settings.default_server,
            routing_servers: settings.routing_servers,
            routing_layout: settings.routing_layout,
            routing_comments: settings.routing_comments,
        };
        try {
            const result = await load();
            if (!result.imported) return;
            onChange({
                routing_rules: result.settings.routing_rules,
                default_action: result.settings.default_action,
                default_server: result.settings.default_server,
                routing_servers: result.settings.routing_servers,
                routing_layout: result.settings.routing_layout,
                routing_comments: result.settings.routing_comments,
            });
            setGeoOffer(result.missing_geo ?? {});
            toast(
                (shown) => (
                    <span className="flex items-center gap-3 text-sm">
                        {t("routing.loaded")}
                        <button
                            type="button"
                            className="font-medium text-primary"
                            onClick={() => {
                                onChange(previous);
                                setGeoOffer({});
                                toast.dismiss(shown.id);
                            }}
                        >
                            {t("common.undo")}
                        </button>
                    </span>
                ),
                { id: "routing-import", duration: 8000 }
            );
        } catch (error) {
            toast.error(errorMessage(error), { id: "routing-import" });
        }
    }, [onChange, settings, t]);

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
        (kind: RoutingKind) => {
            const id = `${kind}-${Date.now().toString(36)}`;
            const layout = settings.routing_layout ?? {};
            const position = nextSourcePosition(rules, layout);
            const rule: RoutingRule =
                kind === "logical"
                    ? {
                          id,
                          kind,
                          values: [],
                          mode: "and",
                          conditions: [
                              { kind: "apps", values: [] },
                              { kind: "network", values: [] },
                          ],
                          action: "proxy",
                      }
                    : { id, kind, values: [], action: "proxy" };

            onChange({
                routing_rules: [...rules, rule],
                routing_layout: { ...layout, [id]: position },
            });
            // Once the node exists, not during this render.
            setTimeout(() => focusRef.current?.(position), 60);
        },
        [onChange, rules, settings.routing_layout]
    );

    const placedServers = useMemo(() => serverIds(settings), [settings]);

    const addServer = useCallback(
        (profileId: string) => {
            const layout = settings.routing_layout ?? {};
            const id = serverNodeId(profileId);
            const position = fallbackPosition(id, placedServers.length);
            onChange({
                routing_servers: [...placedServers, profileId],
                routing_layout: { ...layout, [id]: position },
            });
            setTimeout(() => focusRef.current?.(position), 60);
        },
        [onChange, placedServers, settings.routing_layout]
    );

    const addPreset = useCallback(
        (preset: PresetRule[], placement: PresetPlacement) => {
            const layout = { ...(settings.routing_layout ?? {}) };
            const stamp = Date.now().toString(36);
            const added = preset.map((rule, index) => ({ ...rule, id: `${rule.kind}-${stamp}${index}` }));
            let position = nextSourcePosition(rules, layout);
            added.forEach((rule) => {
                layout[rule.id] = position;
                position = { x: position.x, y: position.y + SOURCE_GAP };
            });
            onChange({
                routing_rules: placement === "first" ? [...added, ...rules] : [...rules, ...added],
                routing_layout: layout,
            });
            const first = layout[added[0]?.id];
            if (first) setTimeout(() => focusRef.current?.(first), 60);
            toast.success(t("routing.preset.added"), { id: "routing-preset" });
        },
        [onChange, rules, settings.routing_layout, t]
    );

    return (
        <div className="enter-stagger absolute inset-0 flex flex-col">
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 sm:px-6 pt-5 pb-3 shrink-0">
                <div className="min-w-0">
                    <h1 className="sr-only">{t("nav.routing")}</h1>
                    <SetupSwitcher settings={settings} onReplace={onReplace} />
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {rules.length === 0
                            ? t("routing.summaryNone", { action: defaultLabel })
                            : t("routing.summary", { count: rules.length, action: defaultLabel })}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={undo}
                        disabled={historySize.past === 0}
                        aria-label={t("routing.undo")}
                        title={t("routing.undo")}
                    >
                        <Undo2 size={15} aria-hidden="true" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={redo}
                        disabled={historySize.future === 0}
                        aria-label={t("routing.redo")}
                        title={t("routing.redo")}
                    >
                        <Redo2 size={15} aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void importRouting()} aria-label={t("routing.import")} title={t("routing.import")}>
                        <Upload size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t("routing.import")}</span>
                    </Button>
                    {pluginSetups.length > 0 ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t("routing.fromPlugins")} title={t("routing.fromPlugins")}>
                                    <Puzzle size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t("routing.fromPlugins")}</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-w-72">
                                {pluginSetups.map(({ plugin, setup }) => (
                                    <DropdownMenuItem
                                        key={plugin.id + setup.file}
                                        className="flex-col items-start gap-0.5 text-xs"
                                        onClick={() =>
                                            void importRouting(() => invoke<FlowImport>("apply_plugin_routing", { id: plugin.id, file: setup.file }))
                                        }
                                    >
                                        <span className="font-medium">{setup.name}</span>
                                        <span className="text-[11px] text-muted-foreground">
                                            {setup.description ? `${setup.description} · ` : ""}
                                            {plugin.name}
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void exportRouting()} aria-label={t("routing.export")} title={t("routing.export")}>
                        <Download size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t("routing.export")}</span>
                    </Button>
                    {rules.length > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => onChange({ routing_rules: [] })}>
                            {t("routing.clear")}
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

            <div className="flex-1 min-h-0 mx-2 sm:mx-4 mb-2 sm:mb-4 flex gap-3">
                {/* The graph reads left to right in every language: sources
                    on the left, destinations on the right, the way the edges
                    are drawn. It is not mirrored in right-to-left layouts. */}
                <div className="relative flex-1 min-w-0 rounded-xl border overflow-hidden" dir="ltr">
                    <GeoCodesContext.Provider value={geoCodes}>
                        <RuleListsContext.Provider value={listsContext}>
                            <ReactFlowProvider>
                                <RoutingCanvas
                                    settings={settings}
                                    hiddenActions={hiddenActions.hidden}
                                    onHideAction={hiddenActions.hide}
                                    onChange={onChange}
                                    profiles={profiles}
                                    hits={hits}
                                    onReady={handleReady}
                                />
                            </ReactFlowProvider>
                        </RuleListsContext.Provider>
                    </GeoCodesContext.Provider>
                    {/* On a phone the palette is a sheet, opened from here. */}
                    {isMobile ? (
                        <Button
                            size="sm"
                            className="absolute bottom-7 end-3 z-10 h-10 gap-1.5 rounded-full px-4 shadow-lg"
                            onClick={() => setPaletteOpen(true)}
                        >
                            <Plus size={16} aria-hidden="true" /> {t("routing.tab.add")}
                        </Button>
                    ) : null}
                </div>
                {isMobile ? (
                    <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
                        <SheetContent side="bottom" className="h-[75vh] rounded-t-2xl px-3 pb-4">
                            <SheetHeader className="px-1 pb-0">
                                <SheetTitle>{t("nav.routing")}</SheetTitle>
                            </SheetHeader>
                            <Palette
                                className="w-full border-0 bg-transparent p-0"
                                defaultAction={settings.default_action}
                                onAddSource={(...args: Parameters<typeof addSource>) => {
                                    addSource(...args);
                                    setPaletteOpen(false);
                                }}
                                onAddNote={() => {
                                    addNote();
                                    setPaletteOpen(false);
                                }}
                                onSetDefault={(action) => onChange({ default_action: action, default_server: "" })}
                                onAddServer={(id) => {
                                    addServer(id);
                                    setPaletteOpen(false);
                                }}
                                onAddPreset={(presetRules, placement) => {
                                    addPreset(presetRules, placement);
                                    setPaletteOpen(false);
                                }}
                                hiddenActions={offeredActions}
                                onShowAction={hiddenActions.show}
                                profiles={profiles}
                                placedServers={placedServers}
                                geoPanel={<GeoPanel settings={settings} onChange={onChange} />}
                                orderPanel={
                                    <RuleOrder
                                        rules={rules}
                                        profiles={profiles}
                                        onReorder={(next) => onChange({ routing_rules: next })}
                                        onFocus={(id) => {
                                            const index = rules.findIndex((rule) => rule.id === id);
                                            const point = (settings.routing_layout ?? {})[id] ?? fallbackPosition(id, Math.max(index, 0));
                                            focusRef.current?.(point);
                                            setPaletteOpen(false);
                                        }}
                                    />
                                }
                            />
                        </SheetContent>
                    </Sheet>
                ) : (
                    <Palette
                        defaultAction={settings.default_action}
                        onAddSource={addSource}
                        onAddNote={addNote}
                        onSetDefault={(action) => onChange({ default_action: action, default_server: "" })}
                        onAddServer={addServer}
                        onAddPreset={addPreset}
                        hiddenActions={offeredActions}
                        onShowAction={hiddenActions.show}
                        profiles={profiles}
                        placedServers={placedServers}
                        geoPanel={<GeoPanel settings={settings} onChange={onChange} />}
                        orderPanel={
                            <RuleOrder
                                rules={rules}
                                profiles={profiles}
                                onReorder={(next) => onChange({ routing_rules: next })}
                                onFocus={(id) => {
                                    const index = rules.findIndex((rule) => rule.id === id);
                                    const point = (settings.routing_layout ?? {})[id] ?? fallbackPosition(id, Math.max(index, 0));
                                    focusRef.current?.(point);
                                }}
                            />
                        }
                    />
                )}
            </div>
        </div>
    );
}

export default RoutingView;

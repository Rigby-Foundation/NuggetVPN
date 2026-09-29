import { useCallback, useEffect, useMemo, useRef } from "react";
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

import { ACTION_META, NODE_TYPES, SOURCE_META } from "@/components/routing/nodes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    AppSettings,
    CanvasPoint,
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
const SOURCE_GAP = 260;
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
        ];
    }, [rules, layout, inboundCounts, updateRule, removeRule]);

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
    onSetDefault,
}: {
    defaultAction: RoutingAction;
    onAddSource: (kind: RoutingSource) => void;
    onSetDefault: (action: RoutingAction) => void;
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

            <p className="px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground">
                Drag from a source&apos;s right edge onto a destination to change
                where it goes.
            </p>
        </aside>
    );
}

function RoutingView({ settings, onChange }: RoutingViewProps) {
    const rules = settings.routing_rules ?? [];
    const defaultLabel = (
        ACTION_META[settings.default_action]?.label ?? "Through the VPN"
    ).toLowerCase();

    // The canvas hands back a focuser so adding a node from the palette brings
    // it into view instead of dropping it below the fold.
    const focusRef = useRef<((point: CanvasPoint) => void) | null>(null);
    const handleReady = useCallback((focus: (point: CanvasPoint) => void) => {
        focusRef.current = focus;
    }, []);

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
        <div className="absolute inset-0 flex flex-col">
            <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 shrink-0">
                <div className="min-w-0">
                    <h1 className="text-base font-semibold tracking-tight">Routing</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {rules.length === 0
                            ? `No rules — everything goes ${defaultLabel}.`
                            : `${rules.length} rule${rules.length === 1 ? "" : "s"}; everything else goes ${defaultLabel}.`}
                    </p>
                </div>
                {rules.length > 0 ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange({ routing_rules: [] })}
                    >
                        Clear rules
                    </Button>
                ) : null}
            </header>

            <div className="flex-1 min-h-0 mx-4 mb-4 flex gap-3">
                <div className="flex-1 min-w-0 rounded-xl border overflow-hidden">
                    <ReactFlowProvider>
                        <RoutingCanvas
                            settings={settings}
                            onChange={onChange}
                            onReady={handleReady}
                        />
                    </ReactFlowProvider>
                </div>
                <Palette
                    defaultAction={settings.default_action}
                    onAddSource={addSource}
                    onSetDefault={(action) => onChange({ default_action: action })}
                />
            </div>
        </div>
    );
}

export default RoutingView;

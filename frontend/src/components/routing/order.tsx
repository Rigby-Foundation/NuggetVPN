import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

import { ACTION_META, kindMeta, SOURCE_META } from "@/components/routing/nodes";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Profile, RoutingRule } from "@/types";

/**
 * The rules in the order the core checks them.
 *
 * The first rule that matches decides where a connection goes, so the order
 * is part of what the routing means — and the canvas, being a map, cannot
 * show it. This list does, and reordering it is how a rule gets priority.
 */
export function RuleOrder({
    rules,
    profiles,
    onReorder,
    onFocus,
}: {
    rules: RoutingRule[];
    profiles: Profile[];
    onReorder: (rules: RoutingRule[]) => void;
    onFocus: (id: string) => void;
}) {
    const t = useT();
    const [dragging, setDragging] = useState<number | null>(null);
    const [over, setOver] = useState<number | null>(null);

    const move = (from: number, to: number) => {
        if (from === to || to < 0 || to >= rules.length) return;
        const next = [...rules];
        const [rule] = next.splice(from, 1);
        next.splice(to, 0, rule);
        onReorder(next);
    };

    const summary = (rule: RoutingRule) => {
        if (rule.kind === "logical") {
            const parts = (rule.conditions ?? []).map((condition) => t(SOURCE_META[condition.kind].label));
            return parts.join(rule.mode === "or" ? " / " : " + ") || t("routing.order.empty");
        }
        const values = rule.values ?? [];
        if (values.length === 0) return t("routing.order.empty");
        const shown = values.slice(0, 2).join(", ");
        return values.length > 2 ? `${shown} +${values.length - 2}` : shown;
    };

    const destination = (rule: RoutingRule) => {
        if (rule.action === "proxy" && rule.server) {
            return profiles.find((profile) => profile.id === rule.server)?.name ?? t("routing.server.gone");
        }
        return t(ACTION_META[rule.action].label);
    };

    if (rules.length === 0) {
        return <p className="px-2 py-3 text-xs text-muted-foreground">{t("routing.order.none")}</p>;
    }

    return (
        <div className="space-y-1">
            <p className="px-2 pt-1 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">{t("routing.order.explain")}</p>
            <ol className="space-y-1">
                {rules.map((rule, index) => {
                    const meta = kindMeta(rule.kind);
                    return (
                        <li
                            key={rule.id}
                            draggable
                            onDragStart={(event) => {
                                setDragging(index);
                                event.dataTransfer.effectAllowed = "move";
                                // Firefox needs data set for a drag to start.
                                event.dataTransfer.setData("text/plain", rule.id);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setOver(index);
                            }}
                            onDragLeave={() => setOver((current) => (current === index ? null : current))}
                            onDrop={(event) => {
                                event.preventDefault();
                                if (dragging !== null) move(dragging, index);
                                setDragging(null);
                                setOver(null);
                            }}
                            onDragEnd={() => {
                                setDragging(null);
                                setOver(null);
                            }}
                            className={cn(
                                "group flex items-center gap-1.5 rounded-lg border bg-background/60 px-1.5 py-1.5 transition-colors",
                                dragging === index && "opacity-40",
                                over === index && dragging !== null && dragging !== index && "border-primary"
                            )}
                        >
                            <GripVertical size={13} className="shrink-0 cursor-grab text-muted-foreground/60" aria-hidden="true" />
                            <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                            <button
                                type="button"
                                onClick={() => onFocus(rule.id)}
                                title={t("routing.order.show")}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                            >
                                <meta.icon size={13} style={{ color: meta.accent }} className="shrink-0" aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs">
                                        {rule.invert ? `${t("routing.condition.not")} ` : ""}
                                        {summary(rule)}
                                    </span>
                                    <span className="block truncate text-[10px] text-muted-foreground">→ {destination(rule)}</span>
                                </span>
                            </button>
                            <span className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => move(index, index - 1)}
                                    aria-label={t("routing.order.up")}
                                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                    <ArrowUp size={11} aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    disabled={index === rules.length - 1}
                                    onClick={() => move(index, index + 1)}
                                    aria-label={t("routing.order.down")}
                                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                    <ArrowDown size={11} aria-hidden="true" />
                                </button>
                            </span>
                        </li>
                    );
                })}
            </ol>
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">{t("routing.order.last")}</p>
        </div>
    );
}

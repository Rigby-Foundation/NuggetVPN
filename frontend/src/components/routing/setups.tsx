import { useState } from "react";
import toast from "react-hot-toast";
import { Check, ChevronDown, Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { AppSettings, RoutingGraph, RoutingSetup } from "@/types";

/** The graph being edited, as a setup's graph. */
function liveGraph(settings: AppSettings): RoutingGraph {
    return {
        rules: settings.routing_rules ?? [],
        default_action: settings.default_action,
        default_server: settings.default_server,
        layout: settings.routing_layout ?? {},
        comments: settings.routing_comments ?? [],
        servers: settings.routing_servers ?? [],
    };
}

const EMPTY_GRAPH: RoutingGraph = { rules: [], default_action: "proxy", layout: {}, comments: [], servers: [] };

type Editing = { kind: "new" } | { kind: "duplicate" } | { kind: "rename"; setup: RoutingSetup } | { kind: "delete"; setup: RoutingSetup };

/**
 * Saved routing setups — "Home", "Work", "Gaming" — and switching between
 * them. Switching goes through Go, which keeps the graph being left in its
 * setup, and restarts a running tunnel on the new one.
 */
export function SetupSwitcher({
    settings,
    onReplace,
}: {
    settings: AppSettings;
    onReplace: (settings: AppSettings) => void;
}) {
    const t = useT();
    const setups = settings.routing_setups ?? [];
    const active = setups.find((setup) => setup.id === settings.active_routing_setup) ?? setups[0];
    const [editing, setEditing] = useState<Editing | null>(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    const nameOf = (setup: RoutingSetup | undefined) =>
        setup?.name ? setup.name : t("routing.setup.main");

    const save = (next: AppSettings) => invoke<AppSettings>("save_settings", { settings: next });

    const run = async (work: () => Promise<AppSettings>) => {
        setBusy(true);
        try {
            onReplace(await work());
            setEditing(null);
        } catch (error) {
            toast.error(errorMessage(error), { id: "routing-setup" });
        } finally {
            setBusy(false);
        }
    };

    // Saved first, so the graph being left is stored as it is on screen even
    // if a save of the last edit is still on its way.
    const switchTo = async (id: string, base: AppSettings = settings) => {
        await save(base);
        return invoke<AppSettings>("switch_routing_setup", { id });
    };

    const create = (graph: RoutingGraph) =>
        run(async () => {
            const id = `setup-${Date.now().toString(36)}`;
            const next = { ...settings, routing_setups: [...setups, { id, name: name.trim(), graph }] };
            return switchTo(id, next);
        });

    const open = (next: Editing, initial: string) => {
        setName(initial);
        setEditing(next);
    };

    const submit = () => {
        if (!editing) return;
        switch (editing.kind) {
            case "new":
                return create(EMPTY_GRAPH);
            case "duplicate":
                return create(structuredClone(liveGraph(settings)));
            case "rename":
                return run(() =>
                    save({
                        ...settings,
                        routing_setups: setups.map((setup) =>
                            setup.id === editing.setup.id ? { ...setup, name: name.trim() } : setup
                        ),
                    })
                );
            case "delete":
                return run(async () => {
                    let current = settings;
                    if (editing.setup.id === settings.active_routing_setup) {
                        const other = setups.find((setup) => setup.id !== editing.setup.id);
                        if (!other) return settings;
                        current = await switchTo(other.id);
                    }
                    return save({
                        ...current,
                        routing_setups: (current.routing_setups ?? []).filter((setup) => setup.id !== editing.setup.id),
                    });
                });
        }
    };

    const titles = {
        new: "routing.setup.new",
        duplicate: "routing.setup.duplicate",
        rename: "routing.setup.rename",
        delete: "routing.setup.delete",
    } as const;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 -ms-2 text-base font-semibold tracking-tight">
                        <span className="max-w-56 truncate">{nameOf(active)}</span>
                        <ChevronDown size={14} className="text-muted-foreground" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                    {setups.map((setup) => (
                        <DropdownMenuItem
                            key={setup.id}
                            disabled={busy}
                            onClick={() => {
                                if (setup.id !== settings.active_routing_setup) {
                                    void run(() => switchTo(setup.id));
                                }
                            }}
                            className="gap-2 text-xs"
                        >
                            <Check
                                size={13}
                                className={setup.id === settings.active_routing_setup ? "" : "invisible"}
                                aria-hidden="true"
                            />
                            <span className="truncate">{nameOf(setup)}</span>
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2 text-xs" onClick={() => open({ kind: "new" }, "")}>
                        <Plus size={13} aria-hidden="true" /> {t("routing.setup.new")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="gap-2 text-xs"
                        onClick={() => open({ kind: "duplicate" }, t("routing.setup.copyName", { name: nameOf(active) }))}
                    >
                        <Copy size={13} aria-hidden="true" /> {t("routing.setup.duplicate")}
                    </DropdownMenuItem>
                    {active ? (
                        <DropdownMenuItem
                            className="gap-2 text-xs"
                            onClick={() => open({ kind: "rename", setup: active }, active.name || nameOf(active))}
                        >
                            <Pencil size={13} aria-hidden="true" /> {t("routing.setup.rename")}
                        </DropdownMenuItem>
                    ) : null}
                    {active && setups.length > 1 ? (
                        <DropdownMenuItem
                            className="gap-2 text-xs text-destructive focus:text-destructive"
                            onClick={() => open({ kind: "delete", setup: active }, "")}
                        >
                            <Trash2 size={13} aria-hidden="true" /> {t("routing.setup.delete")}
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            {editing ? (
                <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : setEditing(null))}>
                    <DialogContent className="sm:max-w-sm">
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submit();
                            }}
                            className="space-y-4"
                        >
                            <DialogHeader>
                                <DialogTitle>{t(titles[editing.kind])}</DialogTitle>
                                <DialogDescription>
                                    {editing.kind === "delete"
                                        ? t("routing.setup.deleteConfirm", { name: nameOf(editing.setup) })
                                        : t("routing.setup.explain")}
                                </DialogDescription>
                            </DialogHeader>
                            {editing.kind !== "delete" ? (
                                <Input
                                    autoFocus
                                    value={name}
                                    maxLength={60}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder={t("routing.setup.namePlaceholder")}
                                    aria-label={t("routing.setup.name")}
                                />
                            ) : null}
                            <DialogFooter>
                                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                                    {t("common.cancel")}
                                </Button>
                                <Button
                                    type="submit"
                                    variant={editing.kind === "delete" ? "destructive" : "default"}
                                    disabled={busy || (editing.kind !== "delete" && !name.trim())}
                                >
                                    {t(editing.kind === "delete" ? "routing.setup.deleteAction" : "common.save")}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            ) : null}
        </>
    );
}

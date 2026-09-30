import { useState } from "react";
import toast from "react-hot-toast";
import {
    AlertTriangle,
    Bell,
    Cable,
    ChevronDown,
    Globe,
    Loader2,
    Network,
    Plus,
    Power,
    Puzzle,
    Radio,
    Route,
    Server,
    Trash2,
} from "lucide-react";

import { PluginFrame, usePlugins } from "@/components/plugins/plugins-provider";
import { SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { errorMessage, invoke } from "@/lib/backend";
import { MessageKey, useT } from "@/lib/i18n";
import { isAndroid } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { PluginInfo, PluginPermission, PluginPreview } from "@/types";

/** Each permission, as the install prompt explains it. */
const PERMISSIONS: Record<PluginPermission, { icon: typeof Radio; label: MessageKey; risky?: boolean }> = {
    state: { icon: Radio, label: "plugins.perm.state" },
    connections: { icon: Cable, label: "plugins.perm.connections" },
    profiles: { icon: Server, label: "plugins.perm.profiles" },
    control: { icon: Power, label: "plugins.perm.control" },
    import: { icon: Plus, label: "plugins.perm.import", risky: true },
    routing: { icon: Route, label: "plugins.perm.routing", risky: true },
    notifications: { icon: Bell, label: "plugins.perm.notifications" },
};

function PluginIcon({ plugin, size = 36 }: { plugin: PluginInfo; size?: number }) {
    return plugin.icon ? (
        <img src={plugin.icon} alt="" width={size} height={size} className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />
    ) : (
        <span className="grid shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" style={{ width: size, height: size }}>
            <Puzzle size={size / 2} aria-hidden="true" />
        </span>
    );
}

/** What a plugin brings, in a line: "2 themes · 1 font · a panel". */
function contents(plugin: PluginInfo, t: ReturnType<typeof useT>): string {
    const parts: string[] = [];
    if (plugin.themes.length) parts.push(t("plugins.has.themes", { count: plugin.themes.length }));
    if (plugin.fonts.length) parts.push(t("plugins.has.fonts", { count: plugin.fonts.length }));
    if (plugin.routing.length) parts.push(t("plugins.has.routing", { count: plugin.routing.length }));
    if (plugin.panel) parts.push(t("plugins.has.panel"));
    if (plugin.background) parts.push(t("plugins.has.background"));
    return parts.join(" · ");
}

function PermissionList({ permissions, network, fresh }: { permissions: PluginPermission[]; network: string[]; fresh?: Set<string> }) {
    const t = useT();
    if (permissions.length === 0 && network.length === 0) {
        return <p className="text-xs text-muted-foreground">{t("plugins.perm.none")}</p>;
    }
    return (
        <ul className="space-y-1.5">
            {permissions.map((permission) => {
                const entry = PERMISSIONS[permission];
                const Icon = entry.icon;
                return (
                    <li key={permission} className="flex items-start gap-2 text-xs">
                        <Icon size={13} className={cn("mt-0.5 shrink-0", entry.risky ? "text-amber-500" : "text-muted-foreground")} aria-hidden="true" />
                        <span className="min-w-0 flex-1">{t(entry.label)}</span>
                        {fresh?.has(permission) ? (
                            <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[10px] font-medium text-primary">{t("plugins.perm.new")}</span>
                        ) : null}
                    </li>
                );
            })}
            {network.map((host) => (
                <li key={host} className="flex items-start gap-2 text-xs">
                    <Globe size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">{t("plugins.perm.network", { host })}</span>
                </li>
            ))}
        </ul>
    );
}

/** The install prompt: everything the plugin brings and asks for. */
function InstallDialog({
    preview,
    busy,
    onCancel,
    onInstall,
}: {
    preview: PluginPreview;
    busy: boolean;
    onCancel: () => void;
    onInstall: () => void;
}) {
    const t = useT();
    const plugin = preview.plugin;
    const fresh = new Set<string>(preview.new_permissions);
    return (
        <Dialog open onOpenChange={(open) => (open || busy ? undefined : onCancel())}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <PluginIcon plugin={plugin} size={40} />
                        <div className="min-w-0 text-start">
                            <DialogTitle className="truncate">{plugin.name}</DialogTitle>
                            <DialogDescription>
                                {preview.installed
                                    ? t("plugins.install.update", { from: preview.installed, to: plugin.version })
                                    : t("plugins.install.version", { version: plugin.version })}
                                {plugin.author ? ` · ${plugin.author}` : ""}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                <div className="space-y-4">
                    {plugin.description ? <p className="text-sm text-muted-foreground">{plugin.description}</p> : null}
                    {contents(plugin, t) ? <p className="text-xs text-muted-foreground">{contents(plugin, t)}</p> : null}
                    <div className="space-y-2 rounded-lg border p-3">
                        <h4 className="text-xs font-medium">{t("plugins.install.asks")}</h4>
                        <PermissionList permissions={plugin.permissions} network={plugin.network} fresh={preview.installed ? fresh : undefined} />
                    </div>
                    {preview.has_script ? (
                        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                            {t("plugins.install.script")}
                        </p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onCancel} disabled={busy}>
                        {t("common.cancel")}
                    </Button>
                    <Button onClick={onInstall} disabled={busy}>
                        {busy ? <Loader2 size={14} className="me-2 animate-spin" aria-hidden="true" /> : null}
                        {t(preview.installed ? "plugins.install.updateAction" : "plugins.install.action")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PluginCard({ plugin }: { plugin: PluginInfo }) {
    const t = useT();
    const { setPlugins, refresh } = usePlugins();
    const [open, setOpen] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [busy, setBusy] = useState(false);

    const toggle = async (enabled: boolean) => {
        setBusy(true);
        try {
            setPlugins(await invoke<PluginInfo[]>("set_plugin_enabled", { id: plugin.id, enabled }));
        } catch (error) {
            toast.error(errorMessage(error), { id: "plugin" });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setConfirmRemove(false);
        setBusy(true);
        try {
            await invoke("remove_plugin", { id: plugin.id });
            await refresh();
            toast.success(t("plugins.removed", { name: plugin.name }), { id: "plugin" });
        } catch (error) {
            toast.error(errorMessage(error), { id: "plugin" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={cn("rounded-xl border bg-card/60", !plugin.enabled && "opacity-70")}>
            <div className="flex items-start gap-3 p-3.5">
                <PluginIcon plugin={plugin} />
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-start"
                >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{plugin.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{plugin.version}</span>
                        {plugin.author ? <span className="text-[11px] text-muted-foreground">{plugin.author}</span> : null}
                    </span>
                    {plugin.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{plugin.description}</span>
                    ) : null}
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        {contents(plugin, t)}
                        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                    </span>
                </button>
                <Switch
                    checked={plugin.enabled}
                    disabled={busy}
                    onCheckedChange={(checked) => void toggle(checked)}
                    aria-label={t("plugins.enabled", { name: plugin.name })}
                />
            </div>

            {open ? (
                <div className="space-y-4 border-t p-3.5">
                    <div className="space-y-2">
                        <h4 className="text-xs font-medium">{t("plugins.allowed")}</h4>
                        <PermissionList permissions={plugin.permissions} network={plugin.network} />
                    </div>
                    {plugin.routing.length > 0 ? (
                        <div className="space-y-2">
                            <h4 className="text-xs font-medium">{t("plugins.routing")}</h4>
                            {plugin.routing.map((setup) => (
                                <div key={setup.file} className="flex items-center gap-3">
                                    <Network size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-medium">{setup.name}</div>
                                        {setup.description ? <div className="text-[11px] text-muted-foreground">{setup.description}</div> : null}
                                    </div>
                                </div>
                            ))}
                            <p className="text-[11px] text-muted-foreground">{t("plugins.routing.hint")}</p>
                        </div>
                    ) : null}
                    {plugin.themes.length > 0 || plugin.fonts.length > 0 ? (
                        <p className="text-[11px] text-muted-foreground">{t("plugins.lookHint")}</p>
                    ) : null}
                    {plugin.homepage ? <p className="break-all font-mono text-[11px] text-muted-foreground">{plugin.homepage}</p> : null}
                    <div className="flex justify-end">
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                            <Trash2 size={13} aria-hidden="true" />
                            {t("plugins.remove")}
                        </Button>
                    </div>
                </div>
            ) : null}

            {plugin.enabled && plugin.panel ? (
                <div className="border-t">
                    {plugin.panel_title ? <h4 className="px-3.5 pt-3 text-xs font-medium text-muted-foreground">{plugin.panel_title}</h4> : null}
                    <PluginFrame key={plugin.version} plugin={plugin} url={plugin.panel} title={plugin.panel_title || plugin.name} />
                </div>
            ) : null}

            {confirmRemove ? (
                <Dialog open onOpenChange={(value) => (value ? undefined : setConfirmRemove(false))}>
                    <DialogContent className="sm:max-w-sm">
                        <DialogHeader>
                            <DialogTitle>{t("plugins.remove.title", { name: plugin.name })}</DialogTitle>
                            <DialogDescription>{t("plugins.remove.description")}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button variant="destructive" onClick={() => void remove()}>
                                {t("plugins.remove")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    );
}

/** Settings → Plugins. */
export function PluginsPanel() {
    const t = useT();
    const { plugins, refresh } = usePlugins();
    const [preview, setPreview] = useState<PluginPreview | null>(null);
    const [busy, setBusy] = useState(false);

    const pick = async () => {
        try {
            const read = await invoke<PluginPreview>("pick_plugin");
            if (read?.token) setPreview(read);
        } catch (error) {
            toast.error(errorMessage(error), { id: "plugin" });
        }
    };

    const install = async () => {
        if (!preview) return;
        setBusy(true);
        try {
            const installed = await invoke<PluginInfo>("install_plugin", { token: preview.token });
            await refresh();
            toast.success(t(preview.installed ? "plugins.updated" : "plugins.installed", { name: installed.name }), { id: "plugin" });
            setPreview(null);
        } catch (error) {
            toast.error(errorMessage(error), { id: "plugin" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <SettingsGroup>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("plugins.description")}</p>
                {isAndroid ? <p className="text-xs leading-relaxed text-muted-foreground">{t("plugins.android")}</p> : null}
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void pick()}>
                    <Plus size={14} aria-hidden="true" />
                    {t("plugins.install")}
                </Button>
            </SettingsGroup>

            {plugins.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{t("plugins.empty")}</p>
            ) : (
                plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} />)
            )}

            {preview ? <InstallDialog preview={preview} busy={busy} onCancel={() => setPreview(null)} onInstall={() => void install()} /> : null}
        </div>
    );
}

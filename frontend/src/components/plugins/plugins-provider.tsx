import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAppearance } from "@/components/appearance-provider";
import { CustomTheme, PLUGIN_THEME_PREFIX, sanitizeTheme, UserFont } from "@/lib/appearance";
import { invoke } from "@/lib/backend";
import { HostActions, registerFrame, setHostActions, setHostPlugins, startPluginHost } from "@/lib/plugin-host";
import { cn } from "@/lib/utils";
import { PluginInfo } from "@/types";

interface PluginsContext {
    plugins: PluginInfo[];
    /** Replaces the list, after an install, removal or toggle. */
    setPlugins: (plugins: PluginInfo[]) => void;
    refresh: () => Promise<void>;
}

const Context = createContext<PluginsContext | null>(null);

export function usePlugins(): PluginsContext {
    const value = useContext(Context);
    if (!value) throw new Error("usePlugins must be used inside PluginsProvider");
    return value;
}

/** A plugin's themes in the theme editor's shape, checked like the user's own. */
function themesOf(plugins: PluginInfo[]): CustomTheme[] {
    return plugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
            plugin.themes.map((theme) =>
                sanitizeTheme(
                    {
                        ...theme,
                        name: theme.name,
                        image: theme.image ? { ...theme.image } : undefined,
                    },
                    PLUGIN_THEME_PREFIX
                )
            )
        )
        .filter((theme): theme is CustomTheme => !!theme);
}

function fontsOf(plugins: PluginInfo[]): UserFont[] {
    return plugins.filter((plugin) => plugin.enabled).flatMap((plugin) => plugin.fonts);
}

/**
 * Loads the plugins, hands their content to the rest of the app, and runs
 * their background pages. `actions` is how the host reaches the app.
 */
export function PluginsProvider({ actions, children }: { actions: HostActions; children: ReactNode }) {
    const [plugins, setPluginsState] = useState<PluginInfo[]>([]);
    const { setPluginContent } = useAppearance();
    const contentRef = useRef(setPluginContent);
    contentRef.current = setPluginContent;

    setHostActions(actions);

    const setPlugins = useCallback((list: PluginInfo[]) => {
        setHostPlugins(list);
        setPluginsState(list);
        contentRef.current(themesOf(list), fontsOf(list));
    }, []);

    const refresh = useCallback(async () => {
        const list = await invoke<PluginInfo[]>("list_plugins").catch(() => null);
        if (Array.isArray(list)) setPlugins(list);
    }, [setPlugins]);

    useEffect(() => {
        const stop = startPluginHost();
        void refresh();
        return stop;
    }, [refresh]);

    const value = useMemo(() => ({ plugins, setPlugins, refresh }), [plugins, setPlugins, refresh]);
    const background = plugins.filter((plugin) => plugin.enabled && plugin.background);

    return (
        <Context.Provider value={value}>
            {children}
            {/* Out of sight and out of the tab order; still running. */}
            <div aria-hidden="true" className="pointer-events-none fixed -start-[9999px] top-0 h-px w-px overflow-hidden">
                {background.map((plugin) => (
                    <PluginFrame key={plugin.id + plugin.version} plugin={plugin} url={plugin.background!} title={plugin.name} hidden />
                ))}
            </div>
        </Context.Provider>
    );
}

/**
 * One plugin page. The sandbox allows scripts and nothing else: no
 * same-origin, forms, popups, top navigation, downloads or modals.
 */
export function PluginFrame({
    plugin,
    url,
    title,
    hidden,
    className,
}: {
    plugin: PluginInfo;
    url: string;
    title: string;
    hidden?: boolean;
    className?: string;
}) {
    const ref = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(240);

    useEffect(() => {
        const target = ref.current?.contentWindow;
        if (!target) return;
        return registerFrame(target, plugin.id, hidden ? undefined : setHeight);
    }, [plugin.id, hidden]);

    return (
        <iframe
            ref={ref}
            src={url}
            title={title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            // Nothing the page is not given: no camera, no clipboard, no
            // location, whatever the webview would otherwise allow.
            allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; usb 'none'; serial 'none'; hid 'none'; bluetooth 'none'"
            tabIndex={hidden ? -1 : undefined}
            className={cn("block w-full border-0 bg-transparent", className)}
            style={hidden ? undefined : { height }}
        />
    );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useVpn } from "@/app/VpnProvider";
import { invoke } from "@/lib/backend";
import { currentLanguage } from "@/lib/i18n";
import { getPlatform, hasNativeRuntime } from "@/lib/platform";
import { registerFrame, setHostActions, setHostPlugins, startPluginHost } from "@/lib/plugin-host";
import { cn } from "@/lib/utils";
import type { PluginInfo } from "@/types";
export function usePlugins() {
  const { plugins, setPlugins } = useVpn();
  const refresh = useCallback(async () => { setPlugins(await invoke<PluginInfo[]>("list_plugins")); }, [setPlugins]);
  return { plugins, setPlugins, refresh };
}
export function PluginRuntime({ children }: { children: ReactNode }) {
  const { plugins, connection } = useVpn();
  const state = useRef(connection); state.current = connection;
  useEffect(() => {
    if (!hasNativeRuntime()) return;
    setHostActions({ state: () => state.current, language: currentLanguage, platform: getPlatform });
    return startPluginHost();
  }, []);
  useEffect(() => setHostPlugins(plugins), [plugins]);
  return <>{children}<div aria-hidden="true" className="pointer-events-none fixed -left-[9999px] size-px overflow-hidden">{plugins.filter((plugin) => plugin.enabled && plugin.background).map((plugin) => <PluginFrame key={plugin.id + plugin.checksum} plugin={plugin} url={plugin.background!} title={plugin.name} hidden />)}</div></>;
}
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

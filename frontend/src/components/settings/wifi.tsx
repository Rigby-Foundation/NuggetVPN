import { useEffect, useState } from "react";
import { Plus, ShieldCheck, Wifi, WifiOff, X } from "lucide-react";

import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { eventPayload, EVENTS, invoke, listen } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { AppSettings, WifiState } from "@/types";

/**
 * Wi-Fi rules: connect on networks that are not trusted, disconnect on ones
 * that are. Trusted networks are named by hand or taken from the current one.
 */
export function WifiPanel({
    appSettings,
    onSettingsChange,
}: {
    appSettings: AppSettings;
    onSettingsChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
    const t = useT();
    const [network, setNetwork] = useState<WifiState | null>(null);
    const [draft, setDraft] = useState("");
    const trusted = appSettings.trusted_networks ?? [];

    useEffect(() => {
        invoke<WifiState>("get_wifi_state").then(setNetwork).catch(() => undefined);
        return listen(EVENTS.wifi, (data) => setNetwork(eventPayload<WifiState>(data)));
    }, []);

    const add = (name: string) => {
        const value = name.trim();
        if (!value || trusted.includes(value)) return;
        onSettingsChange("trusted_networks", [...trusted, value]);
        setDraft("");
    };

    const current = network?.ssid ?? "";
    return (
        <>
            <SettingsGroup>
                <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
                    {network?.on_wifi ? (
                        <Wifi size={16} className="shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                        <WifiOff size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                            {network === null
                                ? "…"
                                : network.unsupported
                                  ? t("wifi.unsupported")
                                  : network.hidden
                                    ? t("wifi.hidden")
                                    : network.on_wifi
                                      ? current
                                      : t("wifi.none")}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                            {network?.hidden
                                ? t("wifi.hidden.hint")
                                : network?.on_wifi && current
                                  ? t(trusted.includes(current) ? "wifi.current.trusted" : "wifi.current.untrusted")
                                  : t("wifi.current")}
                        </div>
                    </div>
                    {network?.on_wifi && current && !trusted.includes(current) ? (
                        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => add(current)}>
                            <ShieldCheck size={13} aria-hidden="true" />
                            {t("wifi.trust")}
                        </Button>
                    ) : null}
                </div>
                <SettingsField
                    label={t("wifi.autoConnect")}
                    description={t("wifi.autoConnect.description")}
                    control={
                        <Switch
                            checked={!!appSettings.wifi_auto_connect}
                            onCheckedChange={(checked) => onSettingsChange("wifi_auto_connect", checked)}
                            aria-label={t("wifi.autoConnect")}
                        />
                    }
                />
                <SettingsField
                    label={t("wifi.trustedDisconnect")}
                    description={t("wifi.trustedDisconnect.description")}
                    control={
                        <Switch
                            checked={!!appSettings.wifi_trusted_disconnect}
                            onCheckedChange={(checked) => onSettingsChange("wifi_trusted_disconnect", checked)}
                            aria-label={t("wifi.trustedDisconnect")}
                        />
                    }
                />
            </SettingsGroup>

            <SettingsGroup title={t("wifi.trusted")} description={t("wifi.trusted.description")}>
                {trusted.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                        {trusted.map((name) => (
                            <li key={name} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pe-1 ps-2.5 text-xs">
                                {name}
                                <button
                                    type="button"
                                    onClick={() => onSettingsChange("trusted_networks", trusted.filter((item) => item !== name))}
                                    aria-label={t("wifi.remove", { name })}
                                    className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                    <X size={11} aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted-foreground">{t("wifi.trusted.empty")}</p>
                )}
                <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        add(draft);
                    }}
                >
                    <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("wifi.trusted.placeholder")} maxLength={64} className="h-8 text-sm" />
                    <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!draft.trim()} aria-label={t("wifi.add")}>
                        <Plus size={14} aria-hidden="true" />
                    </Button>
                </form>
            </SettingsGroup>
        </>
    );
}

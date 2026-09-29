import { Check, RefreshCw, Zap } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SelectableCard from "@/components/ui/selectable-card";
import { Translate, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { Profile, ProxyMode } from "@/types";

interface ProxiesViewProps {
    profiles: Profile[];
    profilePings: Record<string, number | null>;
    selectedSourceDomain: string;
    selectedProxyMode: ProxyMode;
    selectedProfileId: string;
    isRefreshingSource: boolean;
    onSelectProxy: (id: string) => void;
    onSelectAuto: () => void;
    onRefreshSource: () => void;
}

function pingLabel(t: Translate, ping: number | null | undefined): string {
    if (ping === undefined) return "…";
    if (ping === null) return t("proxies.noPing");
    return t("proxies.ms", { ms: ping });
}

/** Colour the latency so the list can be read without parsing every number. */
function pingTone(ping: number | null | undefined): string {
    if (ping === undefined || ping === null) return "text-muted-foreground";
    if (ping < 120) return "text-status-connected";
    if (ping < 300) return "text-status-connecting";
    return "text-status-error";
}

function ProxiesView({
    profiles,
    profilePings,
    selectedSourceDomain,
    selectedProxyMode,
    selectedProfileId,
    isRefreshingSource,
    onSelectProxy,
    onSelectAuto,
    onRefreshSource,
}: ProxiesViewProps) {
    const t = useT();
    const domain = selectedSourceDomain.trim() || LOCAL;
    const isSubscription = domain !== LOCAL;
    const domainProfiles = isSubscription
        ? profiles.filter(
              (profile) => ((profile.source_domain || "").trim() || LOCAL) === domain
          )
        : [];

    const best = domainProfiles.reduce<Profile | null>((winner, profile) => {
        const ping = profilePings[profile.id];
        if (ping === null || ping === undefined) return winner;
        if (!winner) return profile;
        const bestPing = profilePings[winner.id];
        if (bestPing === null || bestPing === undefined) return profile;
        return ping < bestPing ? profile : winner;
    }, null);

    return (
        <PageShell
            title={t("proxies.title")}
            description={
                isSubscription
                    ? t("proxies.description", { count: domainProfiles.length, domain })
                    : t("proxies.single")
            }
            actions={
                isSubscription ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRefreshSource}
                        disabled={isRefreshingSource}
                    >
                        <RefreshCw
                            size={14}
                            className={cn("me-2", isRefreshingSource && "animate-spin")}
                            aria-hidden="true"
                        />
                        {isRefreshingSource ? t("proxies.refreshing") : t("proxies.refresh")}
                    </Button>
                ) : null
            }
        >
            {isSubscription ? (
                <div className="enter-stagger space-y-2">
                    <SelectableCard
                        selected={selectedProxyMode === "auto"}
                        onSelect={onSelectAuto}
                        label={t("proxies.autoLabel")}
                    >
                        <div className="p-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"
                                    aria-hidden="true"
                                >
                                    <Zap size={16} className="text-primary" />
                                </span>
                                <span className="min-w-0">
                                    <span className="font-medium flex items-center gap-2">
                                        {t("proxies.auto")}
                                        {selectedProxyMode === "auto" ? (
                                            <Badge variant="secondary" className="gap-1">
                                                <Check size={12} aria-hidden="true" /> {t("proxies.selected")}
                                            </Badge>
                                        ) : null}
                                    </span>
                                    <span className="block text-xs text-muted-foreground truncate">
                                        {best
                                            ? t("proxies.fastest", { name: best.name })
                                            : t("proxies.autoHint")}
                                    </span>
                                </span>
                            </div>
                            {best ? (
                                <span
                                    className={cn(
                                        "text-xs font-mono tnum shrink-0",
                                        pingTone(profilePings[best.id])
                                    )}
                                >
                                    {pingLabel(t, profilePings[best.id])}
                                </span>
                            ) : null}
                        </div>
                    </SelectableCard>

                    {domainProfiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-8 text-center">
                            {t("proxies.empty")}
                        </p>
                    ) : (
                        <div className="enter-stagger grid gap-2 grid-cols-1 lg:grid-cols-2">
                            {domainProfiles.map((profile) => {
                                const ping = profilePings[profile.id];
                                const selected =
                                    selectedProxyMode === "manual" &&
                                    selectedProfileId === profile.id;
                                return (
                                    <SelectableCard
                                        key={profile.id}
                                        selected={selected}
                                        onSelect={() => onSelectProxy(profile.id)}
                                        label={`${profile.name}, ${profile.protocol}, ${pingLabel(t, ping)}`}
                                    >
                                        <div className="p-4 flex items-center justify-between gap-3">
                                            <span className="min-w-0">
                                                <span className="font-medium flex items-center gap-2 min-w-0">
                                                    <span className="truncate">{profile.name}</span>
                                                    {selected ? (
                                                        <Badge variant="secondary" className="gap-1 shrink-0">
                                                            <Check size={12} aria-hidden="true" /> {t("proxies.selected")}
                                                        </Badge>
                                                    ) : null}
                                                </span>
                                                <span
                                                    className="block text-xs text-muted-foreground font-mono truncate"
                                                    title={`${profile.server} (${profile.protocol})`}
                                                >
                                                    {profile.server} · {profile.protocol}
                                                </span>
                                            </span>
                                            <span
                                                className={cn(
                                                    "text-xs font-mono tnum shrink-0",
                                                    pingTone(ping)
                                                )}
                                            >
                                                {pingLabel(t, ping)}
                                            </span>
                                        </div>
                                    </SelectableCard>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                    {t("proxies.pick")}
                </p>
            )}
        </PageShell>
    );
}

export default ProxiesView;

import { Check, RefreshCw, Zap } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SelectableCard from "@/components/ui/selectable-card";
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

function pingLabel(ping: number | null | undefined): string {
    if (ping === undefined) return "…";
    if (ping === null) return "n/a";
    return `${ping} ms`;
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
            title="Proxies"
            description={
                isSubscription
                    ? `${domainProfiles.length} from ${domain}`
                    : "This configuration is a single profile and has no server list."
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
                            className={cn("mr-2", isRefreshingSource && "animate-spin")}
                            aria-hidden="true"
                        />
                        {isRefreshingSource ? "Refreshing…" : "Refresh"}
                    </Button>
                ) : null
            }
        >
            {isSubscription ? (
                <div className="space-y-2">
                    <SelectableCard
                        selected={selectedProxyMode === "auto"}
                        onSelect={onSelectAuto}
                        label="Automatic server selection"
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
                                        Automatic
                                        {selectedProxyMode === "auto" ? (
                                            <Badge variant="secondary" className="gap-1">
                                                <Check size={12} aria-hidden="true" /> Selected
                                            </Badge>
                                        ) : null}
                                    </span>
                                    <span className="block text-xs text-muted-foreground truncate">
                                        {best
                                            ? `Fastest right now: ${best.name}`
                                            : "Picks the lowest-latency server that answers."}
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
                                    {pingLabel(profilePings[best.id])}
                                </span>
                            ) : null}
                        </div>
                    </SelectableCard>

                    {domainProfiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-8 text-center">
                            No servers in this subscription yet. Try refreshing it.
                        </p>
                    ) : (
                        <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
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
                                        label={`${profile.name}, ${profile.protocol}, ${pingLabel(ping)}`}
                                    >
                                        <div className="p-4 flex items-center justify-between gap-3">
                                            <span className="min-w-0">
                                                <span className="font-medium flex items-center gap-2 min-w-0">
                                                    <span className="truncate">{profile.name}</span>
                                                    {selected ? (
                                                        <Badge variant="secondary" className="gap-1 shrink-0">
                                                            <Check size={12} aria-hidden="true" /> Selected
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
                                                {pingLabel(ping)}
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
                    Pick a subscription from the top bar to see its servers.
                </p>
            )}
        </PageShell>
    );
}

export default ProxiesView;

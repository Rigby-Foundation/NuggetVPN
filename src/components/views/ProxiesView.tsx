import { Check, Zap } from "lucide-react";

import { Profile } from "@/types";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ProxiesViewProps {
  profiles: Profile[];
  profilePings: Record<string, number | null>;
  selectedSourceDomain: string;
  selectedProxyMode: "manual" | "auto";
  selectedProfileId: string;
  onSelectProxy: (id: string) => void;
  onSelectAuto: () => void;
}

function ProxiesView({
  profiles,
  profilePings,
  selectedSourceDomain,
  selectedProxyMode,
  selectedProfileId,
  onSelectProxy,
  onSelectAuto,
}: ProxiesViewProps) {
  const normalizedDomain = selectedSourceDomain.trim() || "local";
  const domainLabel = normalizedDomain === "local" ? "Local" : normalizedDomain;
  const domainProfiles = profiles.filter((profile) => {
    const domain = (profile.source_domain || "").trim() || "local";
    return domain === normalizedDomain;
  });

  const bestProxy = domainProfiles.reduce<Profile | null>((best, profile) => {
    const ping = profilePings[profile.id];
    if (ping === null || ping === undefined) {
      return best;
    }
    if (!best) return profile;
    const bestPing = profilePings[best.id];
    if (bestPing === null || bestPing === undefined) return profile;
    return ping < bestPing ? profile : best;
  }, null);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-bold mb-1">Proxies</h2>
            <p className="text-xs text-muted-foreground">
              {domainProfiles.length === 0
                ? "No proxies available for this configuration."
                : `Showing proxies from ${domainLabel}.`}
            </p>
          </div>

          <Card
            className={cn(
              "cursor-pointer transition-colors",
              selectedProxyMode === "auto" && "border-primary/60 bg-primary/5"
            )}
            onClick={onSelectAuto}
          >
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Zap size={16} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold flex items-center gap-2 min-w-0">
                    Auto
                    {selectedProxyMode === "auto" && (
                      <Badge variant="secondary" className="gap-1">
                        <Check size={12} /> Selected
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {bestProxy
                      ? `Best ping: ${bestProxy.name}`
                      : "Selects the lowest latency proxy to Google."}
                  </div>
                </div>
              </div>
              {bestProxy && profilePings[bestProxy.id] !== undefined && (
                <span className="text-xs font-mono text-muted-foreground">
                  {profilePings[bestProxy.id] === null
                    ? "n/a"
                    : `${profilePings[bestProxy.id]} ms`}
                </span>
              )}
            </CardContent>
          </Card>

          {domainProfiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Import a subscription or add a profile to populate this list.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {domainProfiles.map((profile) => {
                const ping = profilePings[profile.id];
                const isSelected =
                  selectedProxyMode === "manual" &&
                  selectedProfileId === profile.id;
                const pingLabel =
                  ping === undefined ? "..." : ping === null ? "n/a" : `${ping} ms`;
                return (
                  <Card
                    key={profile.id}
                    className={cn(
                      "cursor-pointer transition-colors !py-3",
                      isSelected && "border-primary/60 bg-primary/5"
                    )}
                    onClick={() => onSelectProxy(profile.id)}
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold flex items-center gap-2 min-w-0">
                          <span className="truncate">{profile.name}</span>
                          {isSelected && (
                            <Badge variant="secondary" className="gap-1">
                              <Check size={12} /> Selected
                            </Badge>
                          )}
                        </div>
                        <div
                          className="text-xs text-muted-foreground font-mono truncate"
                          title={`${profile.server} (${profile.protocol})`}
                        >
                          {profile.server} ({profile.protocol})
                        </div>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {pingLabel}
                      </span>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ProxiesView;

import { Check, ChevronDown, Server, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Flag } from "@/components/ui/flag";
import { useUnsupported } from "@/lib/core-support";
import { withoutFlagEmoji } from "@/lib/flags";
import { useT } from "@/lib/i18n";
import { serverSelection } from "@/lib/server-selection";
import { cn } from "@/lib/utils";
import type { ConnectionState, Profile, ProxyMode } from "@/types";

export interface ServerPickerProps {
    profiles: Profile[];
    profilePings: Record<string, number | null>;
    selectedSourceDomain: string;
    selectedProfileId: string;
    selectedProxyMode: ProxyMode;
    connectionState?: ConnectionState;
    locked?: boolean;
    onSelectProxy?: (id: string) => void;
    onSelectAuto?: () => void;
    onTabChange?: (tab: string) => void;
    side?: "bottom" | "left" | "right";
    prominent?: boolean;
    className?: string;
}

/** Shared by every navigation layout and the destination on the home page. */
export function ServerPicker(props: ServerPickerProps) {
    const t = useT();
    const unsupported = useUnsupported();
    const { available, displayed } = serverSelection({ profiles: props.profiles, pings: props.profilePings, domain: props.selectedSourceDomain,
        mode: props.selectedProxyMode, profileId: props.selectedProfileId, state: props.connectionState, unsupported });
    const isAuto = props.selectedProxyMode === "auto";
    const connected = props.connectionState?.status === "connected";
    const name = displayed?.name || (connected ? props.connectionState?.profile : undefined);
    const ping = displayed ? props.profilePings[displayed.id] : undefined;
    const label = name ? withoutFlagEmoji(name) : t(isAuto ? "proxies.auto" : "topbar.none");
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant={props.prominent ? "ghost" : "outline"} size="sm"
                    aria-label={t("serverPicker.label", { name: isAuto ? `${label} · ${t("proxies.auto")}` : label })}
                    className={cn("h-8 min-w-0 shrink max-w-40 gap-2 sm:max-w-52 border-border/60 px-2.5 text-xs font-normal", props.prominent && "h-auto max-w-none sm:max-w-none justify-start rounded-none px-4 py-3 text-start", props.className)}>
                    {name ? <Flag name={name} size={props.prominent ? 22 : 16} /> : isAuto ? <Zap size={15} className="shrink-0 text-primary" /> : <Server size={15} className="shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">
                        <span className={cn("block truncate", props.prominent && "text-sm font-medium")}>{label}</span>
                        {props.prominent && isAuto ? <span className="block truncate text-xs text-muted-foreground">{t(connected ? "proxies.auto" : name ? "serverPicker.recommended" : "proxies.autoHint")}</span> : null}
                    </span>
                    {ping != null ? <span className={cn("shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground", !props.prominent && "hidden sm:inline")}>{ping} ms</span> : null}
                    <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side={props.side ?? "bottom"} align="end" className="max-h-80 w-72 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t(props.locked ? "serverPicker.locked" : "proxies.title")}</DropdownMenuLabel>
                <DropdownMenuItem disabled={props.locked} onClick={props.onSelectAuto} className="gap-2 text-xs">
                    <Zap size={15} className="text-primary" aria-hidden="true" />
                    <span className="flex-1">{t("proxies.auto")}</span>
                    {isAuto ? <Check size={14} className="text-primary" aria-hidden="true" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {available.slice(0, 6).map((profile) => (
                    <DropdownMenuItem key={profile.id} disabled={props.locked || Boolean(unsupported[profile.id])} title={unsupported[profile.id]}
                        onClick={() => props.onSelectProxy?.(profile.id)} className="gap-2 text-xs">
                        <Flag name={profile.name} size={18} />
                        <span className="min-w-0 flex-1 truncate">{withoutFlagEmoji(profile.name)}</span>
                        {props.profilePings[profile.id] != null ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{props.profilePings[profile.id]} ms</span> : null}
                        {!isAuto && props.selectedProfileId === profile.id ? <Check size={14} className="shrink-0 text-primary" aria-hidden="true" /> : null}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => props.onTabChange?.("proxies")} className="text-xs font-medium text-primary">{t("serverPicker.all")} →</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

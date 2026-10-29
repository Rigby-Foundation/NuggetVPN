import type { ConnectionState, Profile, ProxyMode } from "@/types";

/** A measured candidate is a recommendation, never evidence of a live tunnel. */
export function serverSelection({ profiles, pings, domain, mode, profileId, state, unsupported = {} }: {
    profiles: Profile[];
    pings: Record<string, number | null>;
    domain: string;
    mode: ProxyMode;
    profileId: string;
    state?: ConnectionState;
    unsupported?: Record<string, string>;
}) {
    const available = profiles.filter((profile) => (profile.source_domain?.trim() || "local") === (domain.trim() || "local"));
    const best = available.filter((profile) => !unsupported[profile.id] && pings[profile.id] != null && Number.isFinite(pings[profile.id]) && pings[profile.id] >= 0)
        .reduce<Profile | undefined>((winner, profile) => !winner || pings[profile.id]! < pings[winner.id]! ? profile : winner, undefined);
    const actual = state?.status === "connected" ? profiles.find((profile) => profile.id === state.profile_id) : undefined;
    const selected = available.find((profile) => profile.id === profileId);
    // Do not substitute a recommendation when the backend has not named its
    // connected server. In automatic mode that could report the wrong exit.
    const displayed = state?.status === "connected" ? actual : mode === "auto" ? best : selected;
    return { available, best, actual, selected, displayed };
}

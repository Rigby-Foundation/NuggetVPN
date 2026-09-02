import { useCallback, useMemo, useState } from "react";

import { invoke } from "@/lib/backend";
import { ConfigSource, Profile, ProxyMode, RefreshSummary } from "@/types";

/** Profiles added by hand are grouped under this pseudo-domain. */
export const LOCAL = "local";

export function profileDomain(profile: Profile): string {
    return (profile.source_domain || "").trim() || LOCAL;
}

/** Which configuration the user is pointed at, and how a server is picked. */
export interface Selection {
    domain: string;
    mode: ProxyMode;
    profileId: string;
}

const EMPTY_SELECTION: Selection = { domain: LOCAL, mode: "manual", profileId: "" };

/** Local first, then subscriptions alphabetically. */
function sortedDomains(profiles: Profile[]): string[] {
    return Array.from(new Set(profiles.map(profileDomain))).sort((a, b) => {
        if (a === LOCAL) return -1;
        if (b === LOCAL) return 1;
        return a.localeCompare(b);
    });
}

/**
 * Works out what should be selected after the profile list changes.
 *
 * Exported because it is the fiddly part: a subscription refresh can delete the
 * server you had selected, and a delete can remove the whole configuration.
 * Keeping it a pure function of (profiles, selection) means the two callers
 * cannot drift apart, which is exactly what happened when this logic was
 * written out twice inside two different event handlers.
 */
export function reconcileSelection(profiles: Profile[], current: Selection): Selection {
    if (profiles.length === 0) {
        return EMPTY_SELECTION;
    }

    const domains = sortedDomains(profiles);
    const domain = domains.includes(current.domain) ? current.domain : domains[0];

    if (domain === LOCAL) {
        const local = profiles.filter((profile) => profileDomain(profile) === LOCAL);
        if (local.length === 0) {
            return { domain, mode: "auto", profileId: "" };
        }
        const stillThere = local.some((profile) => profile.id === current.profileId);
        return {
            domain,
            mode: "manual",
            profileId: stillThere ? current.profileId : local[0].id,
        };
    }

    const selected = profiles.find((profile) => profile.id === current.profileId);
    if (selected && profileDomain(selected) === domain) {
        return { ...current, domain };
    }
    // A subscription with nothing pinned defaults to letting the backend pick.
    return { domain, mode: "auto", profileId: "" };
}

/** Groups profiles into the sources shown in the sidebar and the top bar. */
export function buildSources(profiles: Profile[]): ConfigSource[] {
    const counts = new Map<string, number>();
    const local: Profile[] = [];

    profiles.forEach((profile) => {
        const domain = profileDomain(profile);
        if (domain === LOCAL) {
            local.push(profile);
            return;
        }
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
    });

    const localEntries: ConfigSource[] = local
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((profile) => ({
            kind: "profile" as const,
            key: `profile:${profile.id}`,
            domain: LOCAL as "local",
            label: profile.name,
            detail: profile.protocol,
            profileId: profile.id,
        }));

    const subscriptionEntries: ConfigSource[] = Array.from(counts.entries())
        .map(([domain, count]) => ({
            kind: "subscription" as const,
            key: `subscription:${domain}`,
            domain,
            label: domain,
            detail: `${count} ${count === 1 ? "proxy" : "proxies"}`,
            count,
        }))
        .sort((a, b) => a.domain.localeCompare(b.domain));

    return [...localEntries, ...subscriptionEntries];
}

/** Profiles, the derived source list, and the current selection. */
export function useProfiles() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

    const sources = useMemo(() => buildSources(profiles), [profiles]);

    /** Applies a new profile list and repairs the selection in one step. */
    const apply = useCallback((next: Profile[]) => {
        setProfiles(next);
        setSelection((current) => reconcileSelection(next, current));
        return next;
    }, []);

    const load = useCallback(async () => {
        return apply(await invoke<Profile[]>("get_profiles"));
    }, [apply]);

    const addProfile = useCallback(
        async (name: string, link: string) => {
            const next = await invoke<Profile[]>("add_profile", { name, link });
            setProfiles(next);
            const added = next[next.length - 1];
            setSelection({
                domain: LOCAL,
                mode: "manual",
                profileId: added?.id ?? "",
            });
            return next;
        },
        []
    );

    const importSubscription = useCallback(async (url: string) => {
        const next = await invoke<Profile[]>("import_subscription", { url });
        setProfiles(next);

        let domain = LOCAL;
        try {
            domain = new URL(url).hostname || LOCAL;
        } catch {
            // The backend validated the URL already; if it is unparseable here
            // just leave the selection where it was.
        }
        setSelection((current) =>
            reconcileSelection(next, { domain, mode: "auto", profileId: "" }) ??
            current
        );
        return next;
    }, []);

    const deleteIds = useCallback(
        async (ids: string[]) => {
            if (ids.length === 0) {
                return profiles;
            }
            return apply(await invoke<Profile[]>("delete_profiles_by_ids", { ids }));
        },
        [apply, profiles]
    );

    const refreshDomain = useCallback(
        async (domain: string) => {
            const summary = await invoke<RefreshSummary>("refresh_subscription_by_domain", {
                sourceDomain: domain,
            });
            await load();
            return summary;
        },
        [load]
    );

    const refreshAll = useCallback(async () => {
        const summary = await invoke<RefreshSummary>("refresh_subscriptions_on_startup");
        await load();
        return summary;
    }, [load]);

    /** Profiles belonging to the selected configuration. */
    const domainProfiles = useMemo(
        () => profiles.filter((profile) => profileDomain(profile) === selection.domain),
        [profiles, selection.domain]
    );

    return {
        profiles,
        setProfiles: apply,
        sources,
        selection,
        setSelection,
        domainProfiles,
        load,
        addProfile,
        importSubscription,
        deleteIds,
        refreshDomain,
        refreshAll,
    };
}

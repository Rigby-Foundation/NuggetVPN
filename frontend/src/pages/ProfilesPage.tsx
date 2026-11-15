import { useState } from "react";
import { useT } from "@/lib/i18n";

import toast from "react-hot-toast";
import { useVpn } from "@/app/vpn-context";
import ProxiesView from "@/components/views/ProxiesView";
import { ImportProfilesButton, SourcePicker } from "@/components/SourcePicker";
import { errorMessage, invoke } from "@/lib/backend";
import type { Profile } from "@/types";

export default function ProfilesPage() {
  const vpn = useVpn();
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await vpn.refreshDomain(vpn.selection.domain);
      if (result.failed > 0)
        throw new Error(
          t("ui.refreshFailed", {
            name:
              vpn.sources.find(
                (source) => source.domain === vpn.selection.domain,
              )?.label ?? vpn.selection.domain,
          }),
        );
      if (result.refreshed)
        toast.success(
          t("configuration.bulk.refreshed", { count: result.refreshed }),
        );
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ProxiesView
      sourceControl={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SourcePicker />
          <ImportProfilesButton />
        </div>
      }
      profiles={vpn.profiles}
      unsupportedProfiles={vpn.unsupportedProfiles}
      profilePings={vpn.profilePings}
      selectedSourceDomain={vpn.selection.domain}
      selectedProxyMode={vpn.selection.mode}
      selectedProfileId={vpn.selection.profileId}
      activeProfileId={
        vpn.connection.status === "connected"
          ? vpn.connection.profile_id
          : undefined
      }
      isRefreshingSource={refreshing}
      onSelectProxy={(id) =>
        vpn.setSelection((previous) => ({
          ...previous,
          mode: "manual",
          profileId: id,
        }))
      }
      onSelectAuto={() =>
        vpn.setSelection((previous) => ({
          ...previous,
          mode: "auto",
          profileId: "",
        }))
      }
      onRefreshSource={() => void refresh()}
      onTest={(ids) => vpn.probeProfiles(vpn.selection.domain, ids)}
      onSetFavorite={async (ids, favorite) => {
        vpn.setProfiles(
          await invoke<Profile[]>("set_favorites", { ids, favorite }),
        );
      }}
      onAddToChain={async (ids) => {
        await vpn.saveSettings({
          ...vpn.settings,
          proxy_chain: [...new Set([...vpn.settings.proxy_chain, ...ids])],
          proxy_chain_enabled: true,
        });
      }}
      onDelete={async (ids) => {
        const remaining = await vpn.deleteIds(ids);
        const alive = new Set(remaining.map((profile) => profile.id));
        vpn.patchSettings({
          proxy_chain: vpn.settings.proxy_chain.filter((id) => alive.has(id)),
        });
      }}
      onUpdateProfile={vpn.updateProfile}
    />
  );
}

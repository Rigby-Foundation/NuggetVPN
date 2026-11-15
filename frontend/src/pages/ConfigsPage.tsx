import { useState } from "react";
import { useT } from "@/lib/i18n";

import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { useVpn } from "@/app/vpn-context";
import ConfigurationView from "@/components/views/ConfigurationView";
import AddModal from "@/components/AddModal";
import { profileDomain, LOCAL } from "@/hooks/use-profiles";
import type { ConfigSource } from "@/types";
export default function ConfigsPage() {
  const vpn = useVpn();
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState("");
  const members = (source: ConfigSource) =>
    vpn.profiles.filter((profile) =>
      source.kind === "profile"
        ? profile.id === source.profileId
        : profileDomain(profile) === source.domain,
    );
  const selectSource = (source: ConfigSource) => {
    vpn.setSelection((previous) =>
      source.kind === "profile"
        ? { domain: LOCAL, mode: "manual", profileId: source.profileId }
        : previous.domain === source.domain
          ? previous
          : { domain: source.domain, mode: "auto", profileId: "" },
    );
  };
  const linkOf = (source: ConfigSource) =>
    source.kind === "subscription"
      ? (members(source).find((profile) => profile.subscription_url)
          ?.subscription_url ?? "")
      : (members(source)[0]?.config_link ?? "");
  const remove = async (sources: ConfigSource[]) => {
    const remaining = await vpn.deleteIds(
      sources.flatMap((source) => members(source).map((profile) => profile.id)),
    );
    const alive = new Set(remaining.map((profile) => profile.id));
    vpn.patchSettings({
      proxy_chain: vpn.settings.proxy_chain.filter((id) => alive.has(id)),
    });
  };
  const refresh = async (sources: ConfigSource[]) => {
    let refreshed = 0;
    const failed: string[] = [];
    try {
      for (const source of sources) {
        if (source.kind !== "subscription") continue;
        setRefreshing(source.domain);
        try {
          const result = await vpn.refreshDomain(source.domain);
          if (result.failed) failed.push(source.label);
          refreshed += result.refreshed;
        } catch {
          failed.push(source.label);
        }
      }
      if (refreshed)
        toast.success(t("configuration.bulk.refreshed", { count: refreshed }));
      if (failed.length)
        throw new Error(t("ui.refreshFailed", { name: failed.join(", ") }));
    } finally {
      setRefreshing("");
    }
  };
  return (
    <>
      <ConfigurationView
        sources={vpn.sources}
        profiles={vpn.profiles}
        selectedSource={vpn.selection.domain}
        selectedProfileId={vpn.selection.profileId}
        refreshingSourceDomain={refreshing}
        onSelectSource={selectSource}
        onOpenSource={(source) => {
          selectSource(source);
          navigate("/profiles");
        }}
        onDeleteSources={remove}
        onRefreshSources={refresh}
        onCopySources={async (sources) => {
          const links = sources.map(linkOf).filter(Boolean);
          if (!links.length)
            throw new Error(t("configuration.bulk.nothingToCopy"));
          await navigator.clipboard.writeText(links.join("\n"));
          toast.success(
            t("configuration.bulk.copied", { count: links.length }),
          );
        }}
        onUpdateProfile={vpn.updateProfile}
        onUpdateSubscriptionUrl={vpn.updateSubscriptionUrl}
        linkOf={linkOf}
        profileIdsOf={(source) => members(source).map((profile) => profile.id)}
        onAdd={() => setOpen(true)}
      />
      <AddModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSaveProfile={async (name, link) => {
          await vpn.addProfile(name, link);
        }}
        onImportSubscription={async (url) => {
          await vpn.importSubscription(url);
        }}
      />
    </>
  );
}

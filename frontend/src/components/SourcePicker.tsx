import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useVpn } from "@/app/vpn-context";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import AddModal from "@/components/AddModal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ActionButton } from "@/components/Workspace";
import { useT } from "@/lib/i18n";
import { ProviderLogo } from "@/components/provider-branding";
import type { SubscriptionInfo } from "@/types";
export function ImportProfilesButton({
  compact = false,
  disabled = false,
}: {
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { addProfile, importSubscription } = useVpn();
  const t = useT();
  return (
    <>
      <ActionButton
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={t("add.addProfile")}
        title={t("add.addProfile")}
        className={compact ? "size-10 p-0" : undefined}
      >
        <Plus className="size-4" aria-hidden="true" />
        {!compact && t("add.addProfile")}
      </ActionButton>
      <AddModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSaveProfile={async (name, link) => {
          await addProfile(name, link);
        }}
        onImportSubscription={async (url) => {
          await importSubscription(url);
        }}
      />
    </>
  );
}
export function SourcePicker({
  disabled = false,
  displayDomain,
}: {
  disabled?: boolean;
  displayDomain?: string;
}) {
  const { profiles, sources, selection, setSelection } = useVpn();
  const t = useT();
  const [open, setOpen] = useState(false);
  const subscriptions = sources.filter(
    (source) => source.kind === "subscription",
  );
  const options: {
    key: string;
    label: string;
    detail: string;
    info?: SubscriptionInfo;
  }[] = [
    { key: LOCAL, label: t("ui.personal"), detail: t("ui.individualProfiles") },
    ...subscriptions.map((source) => ({
      key: source.domain,
      label: source.label,
      detail: t("connections.servers", { count: source.count }),
      info: source.info,
    })),
  ];
  const current =
    options.find(
      (option) => option.key === (displayDomain ?? selection.domain),
    ) ?? options[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={t("ui.profileLabel", { name: current.label })}
        className="flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border border-border/60 bg-card/70 px-2.5 py-2 text-left transition-colors enabled:hover:bg-accent/50"
      >
        <ProviderLogo
          info={current.info}
          className="size-8 rounded-lg"
          fallback={null}
        />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">
            {current.label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {current.detail}
          </span>
        </span>
        <ChevronDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(420px,65vh)] w-64 max-w-[calc(100vw-2rem)] gap-0.5 overflow-y-auto p-1.5"
      >
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          {t("ui.profileSources")}
        </p>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent"
            onClick={() => {
              setSelection((previous) =>
                previous.domain === option.key
                  ? previous
                  : {
                      domain: option.key,
                      mode: option.key === LOCAL ? "manual" : "auto",
                      profileId:
                        option.key === LOCAL
                          ? (profiles.find(
                              (profile) => profileDomain(profile) === LOCAL,
                            )?.id ?? "")
                          : "",
                    },
              );
              setOpen(false);
            }}
          >
            <ProviderLogo
              info={option.info}
              className="size-7 rounded-md"
              fallback={null}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {option.label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {option.detail}
              </span>
            </span>
            {selection.domain === option.key && (
              <Check className="size-4 text-primary" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

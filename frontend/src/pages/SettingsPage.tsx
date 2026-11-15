import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleArrowUp,
  Eye,
  Fingerprint,
  Info,
  Languages,
  Network,
  Palette,
  Plus,
  Puzzle,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { aboutPage } from "@/app/pages";
import { useVpn } from "@/app/vpn-context";
import { Page } from "@/components/Page";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  Pill,
  SearchField,
  Surface,
} from "@/components/Workspace";
import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { BackupPanel } from "@/components/settings/backup";
import { FontSettings } from "@/components/settings/fonts";
import { LogsPanel } from "@/components/settings/logs";
import { UpdatesPanel } from "@/components/settings/updates";
import { PluginsPanel } from "@/components/settings/plugins";
import { ShortcutRecorder } from "@/components/settings/shortcut";
import SubscriptionIdentity from "@/components/views/SubscriptionIdentity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerLabel } from "@/components/ui/flag";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePageMotion, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import {
  LANGUAGES,
  useI18n,
  type MessageKey,
  type LanguageChoice,
} from "@/lib/i18n";
import { errorMessage, invoke } from "@/lib/backend";
import { withoutFlagEmoji } from "@/lib/flags";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import { groupProfiles } from "@/lib/server-selection";
import { useRemembered } from "@/lib/remember";
import { validDnsAddress } from "@/lib/dns";
import type { AppSettings, CloseAction, Profile } from "@/types";

const sections = [
  {
    id: "appearance",
    icon: Palette,
    key: "settings.appearance",
    group: "general",
  },
  {
    id: "language",
    icon: Languages,
    key: "settings.language",
    group: "general",
  },
  {
    id: "behaviour",
    icon: SlidersHorizontal,
    key: "settings.behaviour",
    group: "general",
  },
  {
    id: "updates",
    icon: CircleArrowUp,
    key: "settings.updates",
    group: "general",
  },
  { id: "about", icon: Info, key: "settings.about", group: "general" },
  {
    id: "connection",
    icon: Network,
    key: "settings.connection",
    group: "network",
  },
  { id: "tls", icon: Shield, key: "settings.tls", group: "network" },
  { id: "chain", icon: Waypoints, key: "settings.chain", group: "network" },
  {
    id: "subscriptions",
    icon: Fingerprint,
    key: "settings.subscriptions",
    group: "network",
  },
  { id: "privacy", icon: Eye, key: "settings.privacy", group: "data" },
  { id: "sync", icon: RefreshCw, key: "settings.sync", group: "data" },
  { id: "backup", icon: Archive, key: "settings.backup", group: "data" },
  { id: "logs", icon: Terminal, key: "settings.logs", group: "advanced" },
  { id: "plugins", icon: Puzzle, key: "settings.plugins", group: "advanced" },
] as const;
type SectionId = (typeof sections)[number]["id"];
const groups = ["general", "network", "data", "advanced"] as const;
const closeActions = ["tray", "hide", "quit"] as const;
const searchTerms: Partial<Record<SectionId, MessageKey[]>> = {
  appearance: ["appearance.theme", "appearance.font", "appearance.motion"],
  behaviour: [
    "behaviour.launch",
    "behaviour.autoConnect",
    "behaviour.autoReconnect",
    "behaviour.killSwitch",
    "behaviour.closing",
    "shortcut.title",
  ],
  connection: ["connection.dns", "connection.mtu.description"],
  tls: ["tls.fragmentation.title", "tls.sniSpoof", "tls.mixedCase.title"],
  subscriptions: ["behaviour.autoUpdate", "identity.userAgent"],
  logs: ["logs.export", "privacy.logs"],
  privacy: [
    "privacy.ipCheck",
    "privacy.logs",
    "privacy.appStats",
    "privacy.serverHealth",
  ],
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const vpn = useVpn();
  const { settings, patchSettings } = vpn;
  const { t, choice, setChoice } = useI18n();
  const [section, setSection] = useRemembered<SectionId>(
    "settings.open",
    "appearance",
  );
  const [query, setQuery] = useState("");
  const [chainId, setChainId] = useState("");
  const current = sections.find((item) => item.id === section) ?? sections[0];
  const needle = query.trim().toLocaleLowerCase();
  const matching = sections.filter((item) =>
    [
      t(item.key),
      t(`${item.key}.blurb`),
      ...(searchTerms[item.id] ?? []).map((key) => t(key)),
    ].some((value) => value.toLocaleLowerCase().includes(needle)),
  );
  const selectSection = (id: SectionId) => {
    if (id === "about") {
      void navigate(aboutPage);
      return;
    }
    setSection(id);
    setQuery("");
  };
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    patchSettings({ [key]: value });
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const toggle = (
    key: keyof AppSettings,
    label: string,
    description: string,
    defaultOn = false,
  ) => (
    <SettingsField
      key={key}
      label={label}
      description={description}
      control={
        <Switch
          aria-label={label}
          checked={settings[key] == null ? defaultOn : Boolean(settings[key])}
          onCheckedChange={(value) => patchSettings({ [key]: value })}
        />
      }
    />
  );
  const text = (
    key: keyof AppSettings,
    label: string,
    description?: string,
    type = "text",
  ) => (
    <SettingsField
      key={key}
      stacked
      label={label}
      description={description}
      control={
        <SettingsInput
          label={label}
          type={type}
          value={String(settings[key] ?? "")}
          onCommit={(value) => {
            if (key === "dns" && !validDnsAddress(value)) {
              toast.error(t("routing.dns.invalid"));
              return;
            }
            if (type !== "number") patchSettings({ [key]: value });
            else if (value && Number.isInteger(Number(value)))
              patchSettings({ [key]: Number(value) });
          }}
        />
      }
    />
  );
  let detail: ReactNode;
  switch (current.id) {
    case "appearance":
      detail = <AppearancePanel />;
      break;
    case "language":
      detail = (
        <SettingsGroup description={t("settings.language.description")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { id: "system", label: t("settings.language.followSystem") },
              ...LANGUAGES,
            ].map((language) => (
              <button
                key={language.id}
                type="button"
                aria-pressed={choice === language.id}
                onClick={() => setChoice(language.id as LanguageChoice)}
                className={`rounded-xl border px-3 py-3 text-start text-[13px] ${choice === language.id ? "border-primary/60 bg-primary/5" : "border-border/60 hover:bg-accent/50"}`}
              >
                {language.label}
              </button>
            ))}
          </div>
        </SettingsGroup>
      );
      break;
    case "behaviour":
      detail = (
        <>
          <SettingsGroup title={t("behaviour.startup")}>
            {toggle(
              "launch_at_startup",
              t("behaviour.launch"),
              t("behaviour.launch.description"),
            )}
            {toggle(
              "auto_connect",
              t("behaviour.autoConnect"),
              t("behaviour.autoConnect.description"),
            )}
          </SettingsGroup>
          <SettingsGroup title={t("behaviour.connection")}>
            {toggle(
              "auto_reconnect",
              t("behaviour.autoReconnect"),
              t("behaviour.autoReconnect.description"),
              true,
            )}
            {toggle(
              "kill_switch",
              t("behaviour.killSwitch"),
              t("behaviour.killSwitch.description"),
            )}
            {toggle(
              "server_fallback",
              t("behaviour.fallback"),
              t("behaviour.fallback.description"),
              true,
            )}
            {toggle(
              "fastest_server",
              t("behaviour.fastest"),
              t("behaviour.fastest.description"),
            )}
          </SettingsGroup>
          <SettingsGroup title={t("ui.windowAndAlerts")}>
            {toggle(
              "clipboard_offer",
              t("behaviour.clipboard"),
              t("behaviour.clipboard.description"),
              true,
            )}
            {toggle(
              "notifications",
              t("behaviour.notifications"),
              t("behaviour.notifications.description"),
              true,
            )}
            <SettingsField
              label={t("shortcut.title")}
              description={t("shortcut.description")}
              control={
                <ShortcutRecorder
                  value={settings.global_shortcut}
                  onSaved={(value) => update("global_shortcut", value)}
                />
              }
            />
            <SettingsField
              label={t("behaviour.closing")}
              description={t("behaviour.closing.description")}
              control={
                <Select<CloseAction>
                  items={closeActions.map((value) => ({
                    value,
                    label: t(`close.${value}`),
                  }))}
                  value={settings.close_action}
                  onValueChange={(value) => {
                    if (value !== null) update("close_action", value);
                  }}
                >
                  <SelectTrigger
                    aria-label={t("behaviour.closing")}
                    className="max-w-full text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    alignItemWithTrigger={false}
                    className="w-max max-w-[min(24rem,calc(100vw-2rem))]"
                  >
                    {closeActions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`close.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          </SettingsGroup>
        </>
      );
      break;
    case "connection":
      detail = (
        <>
          <Surface className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <Network className="size-4 text-primary" />
            </span>
            <div className="flex-1">
              <h2 className="text-[13px] font-medium">{t("ui.tunTitle")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("ui.tunDescription")}
              </p>
            </div>
            <Pill>TUN</Pill>
          </Surface>
          <SettingsGroup>
            {text("mtu", "MTU", t("connection.mtu.description"), "number")}
            {text("dns", t("connection.dns"), t("connection.dns.description"))}
          </SettingsGroup>
        </>
      );
      break;
    case "tls":
      detail = (
        <>
          <SettingsGroup>
            {toggle(
              "tls_fragment",
              t("tls.fragmentation.title"),
              t("tls.fragmentation.description"),
            )}
            {settings.tls_fragment && (
              <>
                {text("tls_fragment_size", t("tls.sizeRange"))}
                {text("tls_fragment_sleep", t("tls.sleepRange"))}
              </>
            )}
          </SettingsGroup>
          <SettingsGroup>
            {toggle(
              "tls_mixed_sni_case",
              t("tls.mixedCase.title"),
              t("tls.mixedCase.description"),
            )}
            {toggle(
              "sni_spoof_enabled",
              t("tls.sniSpoof"),
              t("tls.sniSpoof.description"),
            )}
            {settings.sni_spoof_enabled &&
              text("sni_spoof_value", t("tls.sniSpoof.domain"))}
          </SettingsGroup>
        </>
      );
      break;
    case "chain": {
      const exitId = settings.proxy_chain_exit || vpn.selection.profileId;
      const chainOptions = vpn.profiles.filter(
        (profile) =>
          !vpn.unsupportedProfiles[profile.id] &&
          !settings.proxy_chain.includes(profile.id) &&
          profile.id !== exitId,
      );
      const exitOptions = vpn.profiles.filter(
        (profile) => !vpn.unsupportedProfiles[profile.id] && !settings.proxy_chain.includes(profile.id),
      );
      const selectedChain = chainOptions.find((profile) => profile.id === chainId);
      const selectedExit = vpn.profiles.find(
        (profile) => profile.id === settings.proxy_chain_exit,
      );
      detail = (
        <SettingsGroup>
          {toggle(
            "proxy_chain_enabled",
            t("chain.title"),
            t("chain.description"),
          )}
          <div className="space-y-2">
            {settings.proxy_chain.map((id, index) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-xl border border-border/60 p-3"
              >
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13px]">
                  <ServerLabel name={vpn.profiles.find((profile) => profile.id === id)?.name ?? t("chain.unknown")} />
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("chain.moveUp", { index: index + 1 })}
                  disabled={!index}
                  onClick={() => {
                    const chain = [...settings.proxy_chain];
                    [chain[index - 1], chain[index]] = [
                      chain[index],
                      chain[index - 1],
                    ];
                    update("proxy_chain", chain);
                  }}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("chain.moveDown", { index: index + 1 })}
                  disabled={index === settings.proxy_chain.length - 1}
                  onClick={() => {
                    const chain = [...settings.proxy_chain];
                    [chain[index + 1], chain[index]] = [
                      chain[index],
                      chain[index + 1],
                    ];
                    update("proxy_chain", chain);
                  }}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("chain.remove", { index: index + 1 })}
                  onClick={() =>
                    update(
                      "proxy_chain",
                      settings.proxy_chain.filter((item) => item !== id),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Select
              value={selectedChain?.id ?? ""}
              onValueChange={(value) => setChainId(value ?? "")}
            >
              <SelectTrigger
                aria-label={t("chain.select")}
                className="h-10! w-0 min-w-0 flex-1"
              >
                <SelectValue>
                  {selectedChain ? <ServerLabel name={selectedChain.name} /> : t("chain.select")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="" disabled>{t("chain.select")}</SelectItem>
                <ServerSelectGroups profiles={chainOptions} />
              </SelectContent>
            </Select>
            <ActionButton
              disabled={!selectedChain}
              onClick={() => {
                if (!selectedChain) return;
                update("proxy_chain", [
                  ...settings.proxy_chain,
                  selectedChain.id,
                ]);
                setChainId("");
              }}
            >
              <Plus className="size-4" />
              {t("ui.addHop")}
            </ActionButton>
          </div>
          <SettingsField
            label={t("ui.exitServer")}
            description={t("ui.chainExitHint")}
            control={
              <Select
                value={settings.proxy_chain_exit}
                onValueChange={(value) =>
                  update("proxy_chain_exit", value ?? "")
                }
              >
                <SelectTrigger
                  aria-label={t("ui.exitServer")}
                  className="w-64 max-w-full text-xs"
                >
                  <SelectValue>
                    {settings.proxy_chain_exit ? (
                      <ServerLabel name={selectedExit?.name ?? t("chain.unknown")} />
                    ) : t("ui.selectedServer")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="">{t("ui.selectedServer")}</SelectItem>
                  {settings.proxy_chain_exit && !exitOptions.some((profile) => profile.id === settings.proxy_chain_exit) && (
                    <SelectItem value={settings.proxy_chain_exit} disabled>
                      {selectedExit ? <ServerLabel name={selectedExit.name} /> : t("chain.unknown")}
                    </SelectItem>
                  )}
                  <ServerSelectGroups profiles={exitOptions} />
                </SelectContent>
              </Select>
            }
          />
        </SettingsGroup>
      );
      break;
    }
    case "subscriptions":
      detail = (
        <>
          <SettingsGroup>
            {toggle(
              "subscription_auto_update",
              t("behaviour.autoUpdate"),
              t("behaviour.autoUpdate.description"),
              true,
            )}
          </SettingsGroup>
          <SubscriptionIdentity
            appSettings={settings}
            onSettingsChange={update}
            onRegenerateHWID={() =>
              void run(async () =>
                vpn.replaceSettings(
                  await invoke<AppSettings>("regenerate_hwid"),
                ),
              )
            }
          />
        </>
      );
      break;
    case "privacy":
      detail = (
        <SettingsGroup>
          {toggle(
            "ip_check_enabled",
            t("privacy.ipCheck"),
            t("privacy.ipCheck.description"),
            true,
          )}
          {toggle(
            "logging_enabled",
            t("privacy.logs"),
            t("privacy.logs.description"),
            true,
          )}
          {toggle(
            "app_stats",
            t("privacy.appStats"),
            t("privacy.appStats.description"),
            true,
          )}
          {toggle(
            "server_health",
            t("privacy.serverHealth"),
            t("privacy.serverHealth.description"),
            true,
          )}
        </SettingsGroup>
      );
      break;
    case "backup":
      detail = <BackupPanel />;
      break;
    case "updates":
      detail = (
        <UpdatesPanel appSettings={settings} onSettingsChange={update} />
      );
      break;
    case "logs":
      detail = <LogsPanel enabled={settings.logging_enabled === true} onEnable={() => update("logging_enabled", true)} />;
      break;
    case "plugins":
      detail = <PluginsPanel />;
      break;
    case "sync":
      detail = <SyncPanel />;
      break;
    default:
      detail = null;
  }
  return (
    <Page
      title={t("nav.settings")}
      description={t("settings.description")}
      className="@container min-h-full gap-5 px-4 pt-4 pb-0 sm:px-8 sm:pt-8"
    >
      {vpn.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-3 text-xs text-destructive"
        >
          {vpn.error}
          <Button variant="ghost" size="sm" onClick={() => void vpn.reload()}>
            {t("ui.retry")}
          </Button>
        </div>
      )}
      <div className="grid min-w-0 flex-1 gap-6 @min-[740px]:grid-cols-[13.5rem_minmax(0,1fr)] @min-[930px]:gap-10">
        <aside className="min-w-0 space-y-3 @min-[740px]:sticky @min-[740px]:top-4 @min-[740px]:max-h-[calc(100svh-8rem)] @min-[740px]:self-start @min-[740px]:overflow-y-auto @min-[740px]:pe-3">
          <div data-page-part="1">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={t("ui.settingsSearch")}
            />
          </div>
          {!needle && (
            <div data-page-part="2" className="@min-[740px]:hidden">
              <Select<SectionId>
                value={current.id}
                onValueChange={(value) => {
                  if (value !== null) selectSection(value);
                }}
              >
                <SelectTrigger
                  aria-label={t("settings.section")}
                  className="h-10! w-full"
                >
                  <SelectValue>{t(current.key)}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {groups.map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{t(`settings.group.${group}`)}</SelectLabel>
                      {sections
                        .filter((item) => item.group === group)
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {t(item.key)}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <nav
            aria-label={t("settings.section")}
            className={cn("space-y-4", !needle && "hidden @min-[740px]:block")}
          >
            {groups.map((group, index) => {
              const items = matching.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <section key={group} data-page-part={index + 1}>
                  <h2 className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
                    {t(`settings.group.${group}`)}
                  </h2>
                  {items.map(({ id, key, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-current={current.id === id ? "true" : undefined}
                      onClick={() => selectSection(id)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        current.id === id
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">{t(key)}</span>
                    </button>
                  ))}
                </section>
              );
            })}
            {!matching.length && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                {t("ui.settingsNoMatch")}
              </p>
            )}
          </nav>
        </aside>
        <section
          className="min-w-0 pb-4 sm:pb-8 @min-[740px]:border-s @min-[740px]:border-border/60 @min-[740px]:ps-6 @min-[930px]:ps-10"
          aria-labelledby="settings-section-title"
        >
          <div
            key={current.id}
            className="max-w-[58rem]"
          >
            <header data-page-part="1" className="mb-5 flex items-start gap-2.5 border-b border-border/60 pb-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
                <current.icon className="size-[18px]" aria-hidden="true" />
              </div>
              <div>
                <h2
                  id="settings-section-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  {t(current.key)}
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(`${current.key}.blurb`)}
                </p>
              </div>
            </header>
            <fieldset
              data-page-stagger
              disabled={!vpn.loaded}
              className="min-w-0 space-y-5 disabled:opacity-60"
            >
              {detail}
            </fieldset>
          </div>
        </section>
      </div>
    </Page>
  );
}

function SettingsInput({
  label,
  type,
  value,
  onCommit,
}: {
  label: string;
  type: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      aria-label={label}
      type={type}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (type === "number" && (!next || !Number.isInteger(Number(next))))
          setDraft(value);
        else if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="h-9 rounded-lg"
    />
  );
}

const themeModes = [
  { id: "Light", label: "theme.light", preview: "light" },
  { id: "Dark", label: "theme.dark", preview: "dark" },
  { id: "System", label: "settings.appearance.systemTheme", preview: "system" },
] as const satisfies readonly {
  id: ThemeChoice;
  label: MessageKey;
  preview: string;
}[];

function ServerSelectGroups({ profiles }: { profiles: Profile[] }) {
  const t = useI18n().t;
  const { sources } = useVpn();
  const domains = [...new Set(profiles.map(profileDomain))].sort((a, b) => {
    if (a === LOCAL) return -1;
    if (b === LOCAL) return 1;
    return a.localeCompare(b);
  });
  if (!profiles.length) {
    return <SelectItem disabled>{t("chain.noProfiles")}</SelectItem>;
  }
  const renderServer = (profile: Profile) => (
    <SelectItem key={profile.id} value={profile.id} label={withoutFlagEmoji(profile.name)}>
      <ServerLabel name={profile.name} />
    </SelectItem>
  );
  return domains.map((domain) => {
    const source = sources.find((item) => item.kind === "subscription" && item.domain === domain);
    const groups = groupProfiles(profiles.filter((profile) => profileDomain(profile) === domain));
    return (
      <SelectGroup key={domain}>
        <SelectLabel>{domain === LOCAL ? t("ui.personal") : source?.label ?? domain}</SelectLabel>
        {groups.map((group) => group.name ? (
          <SelectGroup key={group.name}>
            <SelectLabel className="text-[11px]">{group.name}</SelectLabel>
            {group.profiles.map(renderServer)}
          </SelectGroup>
        ) : group.profiles.map(renderServer))}
      </SelectGroup>
    );
  });
}

function AppearancePanel() {
  const { t } = useI18n();
  const [theme, setTheme] = useThemeChoice();
  const [motion, setMotion] = usePageMotion();
  return (
    <>
      <SettingsGroup
        title={t("appearance.theme")}
        description={t("appearance.theme.description")}
      >
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {themeModes.map(({ id, label, preview }) => (
            <button
              type="button"
              key={id}
              aria-pressed={theme === id}
              onClick={() => setTheme(id)}
              className={cn(
                "min-w-0 rounded-xl border border-border/60 p-1.5 text-start hover:bg-accent/55 focus-visible:outline-2 focus-visible:outline-ring sm:p-2",
                theme === id && "border-primary/75 bg-primary/8",
              )}
            >
              <span
                aria-hidden="true"
                data-preview={preview}
                className="settings-theme-preview"
              >
                <span />
                <span />
              </span>
              <span className="mt-2 block px-1 text-xs font-medium [overflow-wrap:anywhere]">
                {t(label)}
              </span>
            </button>
          ))}
        </div>
      </SettingsGroup>
      <FontSettings />
      <SettingsGroup
        title={t("appearance.motion")}
        description={t("appearance.motion.description")}
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 sm:gap-3">
          {(["rise", "slide", "fade", "none"] as const).map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={motion === option}
              onClick={() => setMotion(option)}
              className={cn(
                "rounded-lg border border-border/60 px-2 py-2 text-xs hover:bg-accent/55 focus-visible:outline-2 focus-visible:outline-ring",
                motion === option &&
                  "border-primary/75 bg-primary/8 font-semibold",
              )}
            >
              {t(`appearance.motion.${option}`)}
            </button>
          ))}
        </div>
      </SettingsGroup>
    </>
  );
}

function SyncPanel() {
  const vpn = useVpn();
  const { t } = useI18n();
  const [server, setServer] = useState(vpn.settings.auth_server ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title={t("sync.title")} description={t("sync.description")}>
      {vpn.settings.auth_server ? (
        <>
          <p className="text-xs text-muted-foreground">
            {vpn.settings.auth_server}
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke("push_profiles_to_server", {
                    settings: vpn.settings,
                  });
                  toast.success(t("ui.syncUploaded"));
                })
              }
            >
              {t("ui.syncUpload")}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  vpn.setProfiles(
                    await invoke<Profile[]>("pull_profiles_from_server", {
                      settings: vpn.settings,
                    }),
                  );
                })
              }
            >
              {t("ui.syncDownload")}
            </ActionButton>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                vpn.patchSettings({
                  auth_server: null,
                  auth_token: null,
                  skip_auth: false,
                })
              }
            >
              {t("ui.syncDisconnect")}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const token = await invoke<string>("login_user", {
                server,
                username,
                password,
              });
              await vpn.saveSettings({
                ...vpn.settings,
                auth_server: server,
                auth_token: token,
                skip_auth: false,
              });
              setPassword("");
            });
          }}
        >
          <Input
            type="url"
            required
            aria-label={t("sync.title")}
            placeholder="https://your-sync-server"
            value={server}
            onChange={(event) => setServer(event.target.value)}
          />
          <Input
            required
            aria-label={t("ui.username")}
            autoComplete="username"
            placeholder={t("ui.username")}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <Input
            required
            aria-label={t("ui.password")}
            autoComplete="current-password"
            type="password"
            placeholder={t("ui.password")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {t(busy ? "status.connecting" : "sync.connect")}
          </Button>
        </form>
      )}
    </SettingsGroup>
  );
}

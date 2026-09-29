import * as React from "react";
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  CircleArrowUp,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Minimize2,
  Power,
  SlidersHorizontal,
  Fingerprint,
  Languages,
  PackageOpen,
  Palette,
  Plus,
  RefreshCw,
  Router,
  ShieldHalf,
  Trash2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import SubscriptionIdentity from "@/components/views/SubscriptionIdentity";
import ThemePicker from "@/components/settings/theme-picker";
import { BeamMigrationPanel } from "@/components/BeamMigration";
import { useAppearance } from "@/components/appearance-provider";
import { UpdatesPanel } from "@/components/settings/updates";
import { BackupPanel } from "@/components/settings/backup";
import { ShortcutRecorder } from "@/components/settings/shortcut";
import { invoke } from "@/lib/backend";
import {
  FontPicker,
  MotionPicker,
  RadiusPicker,
} from "@/components/settings/appearance-options";
import { effectiveFont, fontLabel } from "@/lib/appearance";
import { LANGUAGES, LanguageChoice, MessageKey, scriptOf, useI18n } from "@/lib/i18n";
import {
  SettingsField,
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/shell";

import { AppSettings, BeamMigrationReport, BeamPreview, CloseAction, Profile } from "@/types";
import { cn } from "@/lib/utils";
import { THEME_PRESETS } from "@/lib/themes";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type SettingsChangeHandler = <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
) => void;

interface SettingsViewProps {
  theme: string | undefined;
  setTheme: (value: string) => void;
  appSettings: AppSettings;
  profiles: Profile[];
  selectedProfileId: string;
  onSettingsChange: SettingsChangeHandler;
  onConnectSync: () => void;
  onDisconnectSync: () => void;
  onRegenerateHWID: () => void;
  /** Present only when a Beam installation was found. */
  beamPreview: BeamPreview | null;
  onMigrateFromBeam: () => Promise<BeamMigrationReport>;
  /** Changes when the sidebar's Settings is clicked while already here. */
  homeSignal: number;
  /** Opens a section from elsewhere: bump n to open id again. */
  openSignal?: { id: string; n: number };
}

type SectionId =
  | "appearance"
  | "language"
  | "behaviour"
  | "connection"
  | "tls"
  | "chain"
  | "subscriptions"
  | "privacy"
  | "sync"
  | "beam"
  | "backup"
  | "updates";

interface Section {
  id: SectionId;
  icon: LucideIcon;
  title: MessageKey;
  /** What the section is for, when nothing better can be said about its state. */
  blurb: MessageKey;
}

const CLOSE_OPTIONS: {
  id: CloseAction;
  icon: LucideIcon;
  label: MessageKey;
  summary: MessageKey;
  description: MessageKey;
}[] = [
  {
    id: "tray",
    icon: Minimize2,
    label: "close.tray",
    summary: "close.tray.summary",
    description: "close.tray.description",
  },
  {
    id: "hide",
    icon: EyeOff,
    label: "close.hide",
    summary: "close.hide.summary",
    description: "close.hide.description",
  },
  {
    id: "quit",
    icon: Power,
    label: "close.quit",
    summary: "close.quit.summary",
    description: "close.quit.description",
  },
];

const SECTIONS: Section[] = [
  {
    id: "appearance",
    icon: Palette,
    title: "settings.appearance",
    blurb: "settings.appearance.blurb",
  },
  {
    id: "language",
    icon: Languages,
    title: "settings.language",
    blurb: "settings.language.blurb",
  },
  {
    id: "behaviour",
    icon: SlidersHorizontal,
    title: "settings.behaviour",
    blurb: "settings.behaviour.blurb",
  },
  {
    id: "connection",
    icon: Router,
    title: "settings.connection",
    blurb: "settings.connection.blurb",
  },
  {
    id: "tls",
    icon: ShieldHalf,
    title: "settings.tls",
    blurb: "settings.tls.blurb",
  },
  {
    id: "chain",
    icon: Waypoints,
    title: "settings.chain",
    blurb: "settings.chain.blurb",
  },
  {
    id: "subscriptions",
    icon: Fingerprint,
    title: "settings.subscriptions",
    blurb: "settings.subscriptions.blurb",
  },
  {
    id: "privacy",
    icon: Eye,
    title: "settings.privacy",
    blurb: "settings.privacy.blurb",
  },
  {
    id: "sync",
    icon: RefreshCw,
    title: "settings.sync",
    blurb: "settings.sync.blurb",
  },
  {
    id: "beam",
    icon: PackageOpen,
    title: "settings.beam",
    blurb: "settings.beam.blurb",
  },
  {
    id: "backup",
    icon: Archive,
    title: "settings.backup",
    blurb: "settings.backup.blurb",
  },
  {
    id: "updates",
    icon: CircleArrowUp,
    title: "settings.updates",
    blurb: "settings.updates.blurb",
  },
];

function SettingsView({
  theme,
  setTheme,
  appSettings,
  profiles,
  selectedProfileId,
  onSettingsChange,
  onConnectSync,
  onDisconnectSync,
  onRegenerateHWID,
  beamPreview,
  onMigrateFromBeam,
  homeSignal,
  openSignal,
}: SettingsViewProps) {
  const [openId, setOpenId] = React.useState<SectionId | null>(null);
  // Which way the last move went, so coming back animates in reverse.
  const [direction, setDirection] = React.useState<"forward" | "back">("forward");

  const navigate = (id: SectionId | null) => {
    setDirection(id === null ? "back" : "forward");
    setOpenId(id);
  };

  // Back to the categories when Settings is clicked from inside a section.
  // The first render is skipped: arriving at Settings is not a request to
  // leave a section.
  const firstHomeSignal = React.useRef(homeSignal);
  React.useEffect(() => {
    if (homeSignal !== firstHomeSignal.current) {
      setDirection("back");
      setOpenId(null);
    }
  }, [homeSignal]);
  React.useEffect(() => {
    if (openSignal && SECTIONS.some((section) => section.id === openSignal.id)) {
      setDirection("forward");
      setOpenId(openSignal.id as SectionId);
    }
  }, [openSignal]);
  const { prefs: appearance, activeCustom } = useAppearance();
  const { t, choice, setChoice, language } = useI18n();
  const languageName = (id: string) => LANGUAGES.find((item) => item.id === id)?.label ?? id;
  const [newChainId, setNewChainId] = React.useState("");
  // Only offered where the system lets the app register one.
  const [shortcutSupported, setShortcutSupported] = React.useState(false);
  React.useEffect(() => {
    invoke<boolean>("global_shortcut_supported").then(setShortcutSupported).catch(() => undefined);
  }, []);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const availableChainProfiles = profiles.filter(
    (p) => p.id !== selectedProfileId && !appSettings.proxy_chain.includes(p.id)
  );

  const handleAddChainProxy = () => {
    if (!newChainId) return;
    if (appSettings.proxy_chain.includes(newChainId)) return;
    onSettingsChange("proxy_chain", [...appSettings.proxy_chain, newChainId]);
    setNewChainId("");
  };

  const handleMoveChainProxy = (index: number, direction: number) => {
    const next = [...appSettings.proxy_chain];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onSettingsChange("proxy_chain", next);
  };

  /**
   * The row subtitle reports what the section is currently set to, so the list
   * answers most questions without being opened at all.
   */
  const subtitleFor = (section: Section): string => {
    switch (section.id) {
      case "appearance": {
        const preset = THEME_PRESETS.find((item) => item.id === theme);
        const themeName = activeCustom
          ? activeCustom.name || t("picker.untitled")
          : preset
            ? t(preset.label)
            : t("settings.appearance.systemTheme");
        return [themeName, fontLabel(t, effectiveFont(appearance.font, scriptOf(language)).id)]
          .filter(Boolean)
          .join(" · ");
      }
      case "language": {
        return choice === "system"
          ? t("settings.language.system", { language: languageName(language) })
          : languageName(choice);
      }
      case "behaviour": {
        const parts = [
          appSettings.launch_at_startup ? t("behaviour.summary.startup") : "",
          appSettings.auto_connect ? t("behaviour.summary.autoConnect") : "",
          t(CLOSE_OPTIONS.find((option) => option.id === appSettings.close_action)?.summary ?? "close.tray.summary"),
        ].filter(Boolean);
        return parts.join(" · ");
      }
      case "connection":
        return t("connection.summary", { mtu: String(appSettings.mtu), dns: appSettings.dns || "—" });
      case "tls": {
        const enabled = [
          appSettings.tls_fragment && t("tls.fragmentation"),
          appSettings.tls_mixed_sni_case && t("tls.mixedCase"),
          appSettings.tls_padding && t("tls.padding"),
          appSettings.sni_spoof_enabled && t("tls.sniSpoof"),
        ].filter(Boolean) as string[];
        return enabled.length === 0 ? t("tls.nothing") : enabled.join(", ");
      }
      case "chain": {
        if (!appSettings.proxy_chain_enabled) return t("common.off");
        const count = appSettings.proxy_chain.length;
        return count === 0
          ? t("chain.summaryEmpty")
          : t("chain.summary", { count });
      }
      case "subscriptions":
        return appSettings.subscription_user_agent || t("identity.defaultIdentity");
      case "privacy":
        return [
          appSettings.ip_check_enabled === false ? t("privacy.summaryOff") : t("privacy.summaryOn"),
          appSettings.logging_enabled === false ? t("privacy.logsOff") : t("privacy.logsOn"),
        ].join(" · ");
      case "sync":
        return appSettings.auth_server || t("status.idle");
      case "beam": {
        if (appSettings.beam_migration === "done") return t("settings.beam.done");
        const count = beamPreview?.subscriptions.length ?? 0;
        return t("settings.beam.found", { count });
      }
      default:
        return section.blurb;
    }
  };

  const detail = (id: SectionId): React.ReactNode => {
    switch (id) {
      case "appearance":
        return (
          <>
            <SettingsGroup
              title={t("appearance.theme")}
              description={t("appearance.theme.description")}
            >
              <ThemePicker theme={theme} setTheme={setTheme} />
            </SettingsGroup>

            <SettingsGroup title={t("appearance.font")} description={t("appearance.font.description")}>
              <FontPicker />
            </SettingsGroup>

            <SettingsGroup
              title={t("appearance.corners")}
              description={t("appearance.corners.description")}
            >
              <RadiusPicker />
            </SettingsGroup>

            <SettingsGroup
              title={t("appearance.motion")}
              description={t("appearance.motion.description")}
            >
              <MotionPicker />
            </SettingsGroup>
          </>
        );

      case "language":
        return (
          <SettingsGroup title={t("settings.language")} description={t("settings.language.description")}>
            <div className="space-y-2" role="radiogroup" aria-label={t("settings.language")}>
              {(["system", ...LANGUAGES.map((item) => item.id)] as LanguageChoice[]).map((id) => {
                const active = choice === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChoice(id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border-2 px-3 py-2.5 text-start transition-colors",
                      active ? "border-primary bg-primary/5" : "border-transparent bg-muted/30 hover:border-border"
                    )}
                  >
                    {/* Each language is named in itself, so it can be found
                        whatever language the app is showing now. */}
                    <span className="text-sm font-medium" lang={id === "system" ? undefined : id}>
                      {id === "system" ? t("settings.language.followSystem") : languageName(id)}
                    </span>
                    {id === "system" ? (
                      <span className="text-xs text-muted-foreground">{languageName(language)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </SettingsGroup>
        );

      case "behaviour":
        return (
          <>
            <SettingsGroup title={t("behaviour.startup")}>
              <SettingsField
                label={t("behaviour.launch")}
                description={t("behaviour.launch.description")}
                control={
                  <Switch
                    checked={appSettings.launch_at_startup}
                    onCheckedChange={(checked) => onSettingsChange("launch_at_startup", checked)}
                    aria-label={t("behaviour.launch")}
                  />
                }
              />
              <SettingsField
                label={t("behaviour.autoConnect")}
                description={t("behaviour.autoConnect.description")}
                control={
                  <Switch
                    checked={appSettings.auto_connect}
                    onCheckedChange={(checked) => onSettingsChange("auto_connect", checked)}
                    aria-label={t("behaviour.autoConnect")}
                  />
                }
              />
            </SettingsGroup>

            {shortcutSupported ? (
              <SettingsGroup title={t("shortcut.title")}>
                <SettingsField
                  label={t("shortcut.label")}
                  description={t("shortcut.description")}
                  control={
                    <ShortcutRecorder
                      value={appSettings.global_shortcut}
                      onSaved={(spec) => onSettingsChange("global_shortcut", spec)}
                    />
                  }
                />
              </SettingsGroup>
            ) : null}

            <SettingsGroup title={t("behaviour.connection")}>
              <SettingsField
                label={t("behaviour.autoReconnect")}
                description={t("behaviour.autoReconnect.description")}
                control={
                  <Switch
                    checked={appSettings.auto_reconnect !== false}
                    onCheckedChange={(checked) => onSettingsChange("auto_reconnect", checked)}
                    aria-label={t("behaviour.autoReconnect")}
                  />
                }
              />
              <SettingsField
                label={t("behaviour.killSwitch")}
                description={t("behaviour.killSwitch.description")}
                control={
                  <Switch
                    checked={appSettings.kill_switch}
                    onCheckedChange={(checked) => onSettingsChange("kill_switch", checked)}
                    aria-label={t("behaviour.killSwitch")}
                  />
                }
              />
              <SettingsField
                label={t("behaviour.fastest")}
                description={t("behaviour.fastest.description")}
                control={
                  <Switch
                    checked={appSettings.fastest_server}
                    onCheckedChange={(checked) => onSettingsChange("fastest_server", checked)}
                    aria-label={t("behaviour.fastest")}
                  />
                }
              />
              <SettingsField
                label={t("behaviour.clipboard")}
                description={t("behaviour.clipboard.description")}
                control={
                  <Switch
                    checked={appSettings.clipboard_offer !== false}
                    onCheckedChange={(checked) => onSettingsChange("clipboard_offer", checked)}
                    aria-label={t("behaviour.clipboard")}
                  />
                }
              />
              <SettingsField
                label={t("behaviour.notifications")}
                description={t("behaviour.notifications.description")}
                control={
                  <Switch
                    checked={appSettings.notifications !== false}
                    onCheckedChange={(checked) => onSettingsChange("notifications", checked)}
                    aria-label={t("behaviour.notifications")}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup title={t("settings.subscriptions")}>
              <SettingsField
                label={t("behaviour.autoUpdate")}
                description={t("behaviour.autoUpdate.description")}
                control={
                  <Switch
                    checked={appSettings.subscription_auto_update !== false}
                    onCheckedChange={(checked) =>
                      onSettingsChange("subscription_auto_update", checked)
                    }
                    aria-label={t("behaviour.autoUpdate")}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup
              title={t("behaviour.closing")}
              description={t("behaviour.closing.description")}
            >
              <div className="space-y-2" role="radiogroup" aria-label={t("behaviour.closing")}>
                {CLOSE_OPTIONS.map((option) => {
                  const active = appSettings.close_action === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onSettingsChange("close_action", option.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg border-2 p-3 text-start transition-colors",
                        active ? "border-primary bg-primary/5" : "border-transparent bg-muted/30 hover:border-border"
                      )}
                    >
                      <option.icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-medium">{t(option.label)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t(option.description)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsGroup>
          </>
        );

      case "connection":
        return (
          <>
            <SettingsGroup>
              <SettingsField
                stacked
                label="MTU"
                description={t("connection.mtu.description")}
                control={
                  <Input
                    id="mtu"
                    type="number"
                    value={appSettings.mtu}
                    onChange={(e) =>
                      onSettingsChange("mtu", parseInt(e.target.value) || 9000)
                    }
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsField
                stacked
                label={t("connection.dns")}
                description={t("connection.dns.description")}
                control={
                  <Input
                    id="dns"
                    type="text"
                    value={appSettings.dns}
                    onChange={(e) => onSettingsChange("dns", e.target.value)}
                  />
                }
              />
            </SettingsGroup>
          </>
        );

      case "tls":
        return (
          <>
            <SettingsGroup>
              <SettingsField
                label={t("tls.fragmentation.title")}
                description={t("tls.fragmentation.description")}
                control={
                  <Switch
                    checked={appSettings.tls_fragment}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_fragment", checked)
                    }
                    aria-label={t("tls.fragmentation.title")}
                  />
                }
              />

              {appSettings.tls_fragment && (
                <div className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <Label className="mb-1 block text-xs">{t("tls.sizeRange")}</Label>
                    <Input
                      type="text"
                      value={appSettings.tls_fragment_size}
                      onChange={(e) =>
                        onSettingsChange("tls_fragment_size", e.target.value)
                      }
                      placeholder="100-200"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs">{t("tls.sleepRange")}</Label>
                    <Input
                      type="text"
                      value={appSettings.tls_fragment_sleep}
                      onChange={(e) =>
                        onSettingsChange("tls_fragment_sleep", e.target.value)
                      }
                      placeholder="10-20"
                    />
                  </div>
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup>
              <SettingsField
                label={t("tls.mixedCase.title")}
                description={t("tls.mixedCase.description")}
                control={
                  <Switch
                    checked={appSettings.tls_mixed_sni_case}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_mixed_sni_case", checked)
                    }
                    aria-label={t("tls.mixedCase.title")}
                  />
                }
              />

              <SettingsField
                label={t("tls.padding.title")}
                description={t("tls.padding.description")}
                control={
                  <Switch
                    checked={appSettings.tls_padding}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_padding", checked)
                    }
                    aria-label={t("tls.padding.title")}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsField
                label={t("tls.sniSpoof")}
                description={t("tls.sniSpoof.description")}
                control={
                  <Switch
                    checked={appSettings.sni_spoof_enabled}
                    onCheckedChange={(checked) =>
                      onSettingsChange("sni_spoof_enabled", checked)
                    }
                    aria-label={t("tls.sniSpoof")}
                  />
                }
              />

              {appSettings.sni_spoof_enabled && (
                <div className="border-t pt-4">
                  <Label className="mb-1 block text-xs">{t("tls.sniSpoof.domain")}</Label>
                  <Input
                    type="text"
                    value={appSettings.sni_spoof_value}
                    onChange={(e) =>
                      onSettingsChange("sni_spoof_value", e.target.value)
                    }
                    placeholder="www.google.com"
                  />
                </div>
              )}
            </SettingsGroup>
          </>
        );

      case "chain":
        return (
          <SettingsGroup>
            <SettingsField
              label={t("chain.title")}
              description={t("chain.description")}
              control={
                <Switch
                  checked={appSettings.proxy_chain_enabled}
                  onCheckedChange={(checked) =>
                    onSettingsChange("proxy_chain_enabled", checked)
                  }
                  aria-label={t("settings.chain")}
                />
              }
            />

            {appSettings.proxy_chain_enabled && (
              <div className="space-y-3 border-t pt-4">
                <div className="text-xs text-muted-foreground">
                  {t("chain.exit")}{" "}
                  <span className="font-medium text-foreground">
                    {selectedProfile?.name || t("chain.noneSelected")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("chain.order")}
                </p>

                <div className="flex gap-2">
                  <Select
                    value={newChainId || undefined}
                    onValueChange={setNewChainId}
                    disabled={availableChainProfiles.length === 0}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue
                        placeholder={
                          availableChainProfiles.length === 0
                            ? t("chain.noProfiles")
                            : t("chain.select")
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableChainProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="shrink-0 gap-1 text-xs"
                    onClick={handleAddChainProxy}
                    disabled={!newChainId}
                  >
                    <Plus size={12} /> {t("common.add")}
                  </Button>
                </div>

                {appSettings.proxy_chain.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("chain.empty")}
                  </p>
                ) : (
                  <div className="max-h-[220px] divide-y overflow-y-auto rounded-md border">
                    {appSettings.proxy_chain.map((id, index) => {
                      const profile = profiles.find((p) => p.id === id);
                      return (
                        <div
                          key={id}
                          className="flex items-center justify-between p-2 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-muted-foreground">
                              {t("chain.hop", { index: index + 1 })}
                            </div>
                            <div className="truncate">
                              {profile?.name || t("chain.unknown")}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={() => handleMoveChainProxy(index, -1)}
                              disabled={index === 0}
                              aria-label={t("chain.moveUp", { index: index + 1 })}
                            >
                              <ChevronUp size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={() => handleMoveChainProxy(index, 1)}
                              disabled={
                                index === appSettings.proxy_chain.length - 1
                              }
                              aria-label={t("chain.moveDown", { index: index + 1 })}
                            >
                              <ChevronDown size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                onSettingsChange(
                                  "proxy_chain",
                                  appSettings.proxy_chain.filter((p) => p !== id)
                                )
                              }
                              aria-label={t("chain.remove", { index: index + 1 })}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </SettingsGroup>
        );

      case "subscriptions":
        return (
          <SubscriptionIdentity
            appSettings={appSettings}
            onSettingsChange={onSettingsChange}
            onRegenerateHWID={onRegenerateHWID}
          />
        );

      case "privacy":
        return (
          <SettingsGroup>
            <SettingsField
              label={t("privacy.ipCheck")}
              description={t("privacy.ipCheck.description")}
              control={
                <Switch
                  checked={appSettings.ip_check_enabled !== false}
                  onCheckedChange={(checked) =>
                    onSettingsChange("ip_check_enabled", checked)
                  }
                  aria-label={t("privacy.ipCheck")}
                />
              }
            />
            <SettingsField
              label={t("privacy.logs")}
              description={t("privacy.logs.description")}
              control={
                <Switch
                  checked={appSettings.logging_enabled !== false}
                  onCheckedChange={(checked) =>
                    onSettingsChange("logging_enabled", checked)
                  }
                  aria-label={t("privacy.logs")}
                />
              }
            />
          </SettingsGroup>
        );

      case "updates":
        return <UpdatesPanel appSettings={appSettings} onSettingsChange={onSettingsChange} />;

      case "backup":
        return <BackupPanel />;

      case "sync":
        return (
          <SettingsGroup
            title={t("sync.title")}
            description={t("sync.description")}
          >
            {appSettings.auth_server ? (
              <>
                <div className="rounded-xl bg-muted p-4">
                  <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 size={12} className="text-status-connected" />
                    {t("sync.connectedTo")}
                  </div>
                  <div className="truncate font-mono text-sm">
                    {appSettings.auth_server}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={onDisconnectSync}
                >
                  {t("connection.disconnect")}
                </Button>
              </>
            ) : (
              <Button className="w-full gap-2" onClick={onConnectSync}>
                <RefreshCw size={16} /> {t("sync.connect")}
              </Button>
            )}
          </SettingsGroup>
        );

      case "beam":
        return beamPreview ? (
          <SettingsGroup
            title="Beam"
            description={t("settings.beam.description")}
          >
            <BeamMigrationPanel preview={beamPreview} onImport={onMigrateFromBeam} />
          </SettingsGroup>
        ) : null;

      default:
        return null;
    }
  };

  const open = SECTIONS.find((section) => section.id === openId);

  return (
    // Keyed per page: each list or section is a fresh mount, which is what
    // plays its entrance. The wrapper carries the direction for the CSS.
    <div className="contents" data-enter-dir={direction}>
      <PageShell
        key={openId ?? "list"}
        fill
        title={open ? t(open.title) : t("nav.settings")}
        description={open ? t(open.blurb) : t("settings.description")}
        actions={
          open ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(null)}
            >
              <ArrowLeft size={14} className="rtl:-scale-x-100" /> {t("nav.settings")}
            </Button>
          ) : undefined
        }
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {open ? (
              <div className="enter-stagger space-y-4 pe-1">{detail(open.id)}</div>
            ) : (
              <div className="enter-stagger space-y-2 pe-1">
                {SECTIONS.filter((section) => section.id !== "beam" || beamPreview).map((section) => (
                  <SettingsRow
                    key={section.id}
                    icon={section.icon}
                    title={t(section.title)}
                    subtitle={subtitleFor(section)}
                    onClick={() => navigate(section.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </PageShell>
    </div>
  );
}

export default SettingsView;

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Fingerprint,
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
import {
  SettingsField,
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/shell";

import { AppSettings, BeamMigrationReport, BeamPreview, Profile } from "@/types";
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
}

type SectionId =
  | "appearance"
  | "connection"
  | "tls"
  | "chain"
  | "subscriptions"
  | "privacy"
  | "sync"
  | "beam";

interface Section {
  id: SectionId;
  icon: LucideIcon;
  title: string;
  /** What the section is for, when nothing better can be said about its state. */
  blurb: string;
}

const SECTIONS: Section[] = [
  {
    id: "appearance",
    icon: Palette,
    title: "Appearance",
    blurb: "Theme and colours",
  },
  {
    id: "connection",
    icon: Router,
    title: "Connection",
    blurb: "Packet size and name resolution",
  },
  {
    id: "tls",
    icon: ShieldHalf,
    title: "TLS and obfuscation",
    blurb: "Make the handshake harder to filter",
  },
  {
    id: "chain",
    icon: Waypoints,
    title: "Proxy chain",
    blurb: "Route through more than one server",
  },
  {
    id: "subscriptions",
    icon: Fingerprint,
    title: "Subscriptions",
    blurb: "Client identity and device id",
  },
  {
    id: "privacy",
    icon: Eye,
    title: "Privacy",
    blurb: "What this app sends elsewhere",
  },
  {
    id: "sync",
    icon: RefreshCw,
    title: "Synchronisation",
    blurb: "Profiles across your devices",
  },
  {
    id: "beam",
    icon: PackageOpen,
    title: "Import from Beam",
    blurb: "Subscriptions and settings from Beam",
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
}: SettingsViewProps) {
  const [openId, setOpenId] = React.useState<SectionId | null>(null);
  const [newChainId, setNewChainId] = React.useState("");

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
        return preset ? preset.label : "Follows the system";
      }
      case "connection":
        return `MTU ${appSettings.mtu} · DNS ${appSettings.dns || "not set"}`;
      case "tls": {
        const enabled = [
          appSettings.tls_fragment && "fragmentation",
          appSettings.tls_mixed_sni_case && "mixed case",
          appSettings.tls_padding && "padding",
          appSettings.sni_spoof_enabled && "SNI spoof",
        ].filter(Boolean) as string[];
        return enabled.length === 0 ? "Nothing enabled" : enabled.join(", ");
      }
      case "chain": {
        if (!appSettings.proxy_chain_enabled) return "Off";
        const count = appSettings.proxy_chain.length;
        return count === 0
          ? "On, but no hops added"
          : `${count} hop${count === 1 ? "" : "s"} before the exit`;
      }
      case "subscriptions":
        return appSettings.subscription_user_agent || "Default identity";
      case "privacy":
        return appSettings.ip_check_enabled === false
          ? "Address check off"
          : "Address check on";
      case "sync":
        return appSettings.auth_server || "Not connected";
      case "beam": {
        if (appSettings.beam_migration === "done") return "Already imported; can be run again";
        const count = beamPreview?.subscriptions.length ?? 0;
        return `Found ${count} profile${count === 1 ? "" : "s"} on this computer`;
      }
      default:
        return section.blurb;
    }
  };

  const detail = (id: SectionId): React.ReactNode => {
    switch (id) {
      case "appearance":
        return (
          <SettingsGroup
            title="Theme"
            description="Applies straight away and is remembered for next time."
          >
            <ThemePicker theme={theme} setTheme={setTheme} />
          </SettingsGroup>
        );

      case "connection":
        return (
          <>
            <SettingsGroup>
              <SettingsField
                stacked
                label="MTU"
                description="The largest packet the tunnel will carry. 9000 suits most links; lower it if large transfers stall."
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
                label="DNS server"
                description="Where names are resolved while connected, for example 1.1.1.1."
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
                label="Fragmentation"
                description="Splits the TLS record so the server name is not in one readable piece."
                control={
                  <Switch
                    checked={appSettings.tls_fragment}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_fragment", checked)
                    }
                    aria-label="TLS fragmentation"
                  />
                }
              />

              {appSettings.tls_fragment && (
                <div className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <Label className="mb-1 block text-xs">Size range</Label>
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
                    <Label className="mb-1 block text-xs">Sleep range (ms)</Label>
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
                label="Mixed SNI case"
                description="Randomises the capitalisation of the server name, so a filter matching it literally misses."
                control={
                  <Switch
                    checked={appSettings.tls_mixed_sni_case}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_mixed_sni_case", checked)
                    }
                    aria-label="Mixed SNI case"
                  />
                }
              />

              <SettingsField
                label="Record padding"
                description="Adds random bytes so handshakes are not all the same length."
                control={
                  <Switch
                    checked={appSettings.tls_padding}
                    onCheckedChange={(checked) =>
                      onSettingsChange("tls_padding", checked)
                    }
                    aria-label="TLS padding"
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsField
                label="SNI spoof"
                description="Sends a different server name in the handshake."
                control={
                  <Switch
                    checked={appSettings.sni_spoof_enabled}
                    onCheckedChange={(checked) =>
                      onSettingsChange("sni_spoof_enabled", checked)
                    }
                    aria-label="SNI spoof"
                  />
                }
              />

              {appSettings.sni_spoof_enabled && (
                <div className="border-t pt-4">
                  <Label className="mb-1 block text-xs">Domain to send</Label>
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
              label="Chain through other profiles"
              description="Traffic passes through each hop in turn before reaching the exit."
              control={
                <Switch
                  checked={appSettings.proxy_chain_enabled}
                  onCheckedChange={(checked) =>
                    onSettingsChange("proxy_chain_enabled", checked)
                  }
                  aria-label="Proxy chain"
                />
              }
            />

            {appSettings.proxy_chain_enabled && (
              <div className="space-y-3 border-t pt-4">
                <div className="text-xs text-muted-foreground">
                  Exit profile:{" "}
                  <span className="font-medium text-foreground">
                    {selectedProfile?.name || "None selected"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Order runs from the first hop, closest to you, to the last one
                  before the exit.
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
                            ? "No profiles available"
                            : "Select profile to add"
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
                    <Plus size={12} /> Add
                  </Button>
                </div>

                {appSettings.proxy_chain.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No proxies in the chain.
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
                              Hop {index + 1}
                            </div>
                            <div className="truncate">
                              {profile?.name || "Unknown profile"}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              onClick={() => handleMoveChainProxy(index, -1)}
                              disabled={index === 0}
                              aria-label={`Move hop ${index + 1} up`}
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
                              aria-label={`Move hop ${index + 1} down`}
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
                              aria-label={`Remove hop ${index + 1}`}
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
              label="Check my public address"
              description="Asks ipinfo.io which address your traffic comes from, so the connection screen can show it. This is a request to a third party; turn it off and nothing is sent."
              control={
                <Switch
                  checked={appSettings.ip_check_enabled !== false}
                  onCheckedChange={(checked) =>
                    onSettingsChange("ip_check_enabled", checked)
                  }
                  aria-label="Check my public address"
                />
              }
            />
          </SettingsGroup>
        );

      case "sync":
        return (
          <SettingsGroup
            title="Sync server"
            description="Keeps your profiles the same on every device signed in to the same server."
          >
            {appSettings.auth_server ? (
              <>
                <div className="rounded-xl bg-muted p-4">
                  <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                    <CheckCircle2 size={12} className="text-status-connected" />
                    Connected to
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
                  Disconnect
                </Button>
              </>
            ) : (
              <Button className="w-full gap-2" onClick={onConnectSync}>
                <RefreshCw size={16} /> Connect sync server
              </Button>
            )}
          </SettingsGroup>
        );

      case "beam":
        return beamPreview ? (
          <SettingsGroup
            title="Beam"
            description="Beam's own files are only read, never changed, so this is safe to run again."
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
    <PageShell
      fill
      title={open ? open.title : "Settings"}
      description={open ? open.blurb : "Client preferences and tunnel behaviour."}
      actions={
        open ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setOpenId(null)}
          >
            <ArrowLeft size={14} /> Settings
          </Button>
        ) : undefined
      }
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {open ? (
            <div className="space-y-4 pr-1">{detail(open.id)}</div>
          ) : (
            <div className="space-y-2 pr-1">
              {SECTIONS.filter((section) => section.id !== "beam" || beamPreview).map((section) => (
                <SettingsRow
                  key={section.id}
                  icon={section.icon}
                  title={section.title}
                  subtitle={subtitleFor(section)}
                  onClick={() => setOpenId(section.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </PageShell>
  );
}

export default SettingsView;

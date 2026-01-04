import { open } from "@tauri-apps/plugin-dialog";
import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Laptop,
  Moon,
  Plus,
  RotateCw,
  Sun,
  Trash2,
} from "lucide-react";

import { AppSettings, Profile } from "@/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
}

function SettingsView({
  theme,
  setTheme,
  appSettings,
  profiles,
  selectedProfileId,
  onSettingsChange,
  onConnectSync,
  onDisconnectSync,
}: SettingsViewProps) {
  const [newDomain, setNewDomain] = React.useState("");
  const [newChainId, setNewChainId] = React.useState("");
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const availableChainProfiles = profiles.filter(
    (p) => p.id !== selectedProfileId && !appSettings.proxy_chain.includes(p.id)
  );

  const handleAddApp = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Applications",
            extensions: ["exe", "app"],
          },
        ],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];

        const fileNames = paths.map((p) => {
          const parts = p.split(/[/\\]/);
          return parts[parts.length - 1];
        });

        // Filter valid filenames and distinct
        const newApps = [...appSettings.routing_apps, ...fileNames];

        const uniqueApps = Array.from(new Set(newApps)).filter(Boolean);
        onSettingsChange("routing_apps", uniqueApps);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddDomain = () => {
    if (!newDomain) return;
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    // Basic validation
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      // You might want to show an error toast here, but for now just console.error
      console.error("Invalid domain format");
      return;
    }

    if (!appSettings.routing_domains.includes(domain)) {
      onSettingsChange("routing_domains", [...appSettings.routing_domains, domain]);
      setNewDomain("");
    }
  };

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

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex-none px-6 pt-6 pb-2">
        <h1 className="text-3xl font-black tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground mb-4">
          Configure your client preferences
        </p>
      </div>

      <div className="flex-1 overflow-hidden px-6 pb-6">
        <Tabs defaultValue="general" className="h-full flex flex-col">
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="tls">TLS</TabsTrigger>
            <TabsTrigger value="split-tunneling">Split Tunneling</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-6">
                <Card>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">Appearance</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Customize the application theme.
                        </div>
                      </div>
                      <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">
                            <div className="flex items-center gap-2">
                              <Sun size={14} /> Light
                            </div>
                          </SelectItem>
                          <SelectItem value="dark">
                            <div className="flex items-center gap-2">
                              <Moon size={14} /> Dark
                            </div>
                          </SelectItem>
                          <SelectItem value="system">
                            <div className="flex items-center gap-2">
                              <Laptop size={14} /> System
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-sm font-medium">Synchronization</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Sync your profiles across devices.
                        </div>
                      </div>
                      {appSettings.auth_server && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-green-500 font-mono flex items-center gap-1">
                            <CheckCircle2 size={12} /> Connected
                          </span>
                        </div>
                      )}
                    </div>

                    {appSettings.auth_server ? (
                      <>
                        <div className="bg-muted rounded-xl p-4 mb-4">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Server
                          </div>
                          <div className="text-sm font-mono truncate">
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
                        <RotateCw size={16} /> Connect Sync Server
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="connection" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-6">
                <Card>
                  <CardContent>
                    <Label htmlFor="mtu" className="mb-2 block">
                      MTU
                    </Label>
                    <Input
                      id="mtu"
                      type="number"
                      value={appSettings.mtu}
                      onChange={(e) =>
                        onSettingsChange("mtu", parseInt(e.target.value) || 9000)
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Maximum Transmission Unit. Default is 9000.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Label htmlFor="dns" className="mb-2 block">
                      DNS Server
                    </Label>
                    <Input
                      id="dns"
                      type="text"
                      value={appSettings.dns}
                      onChange={(e) => onSettingsChange("dns", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Primary DNS server address (e.g., 1.1.1.1).
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">Proxy Chain</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Route the selected profile through additional proxies.
                        </div>
                      </div>
                      <Switch
                        checked={appSettings.proxy_chain_enabled}
                        onCheckedChange={(checked) =>
                          onSettingsChange("proxy_chain_enabled", checked)
                        }
                      />
                    </div>

                    {appSettings.proxy_chain_enabled && (
                      <div className="space-y-3 pt-4 border-t">
                        <div className="text-xs text-muted-foreground">
                          Exit profile:{" "}
                          <span className="text-foreground font-medium">
                            {selectedProfile?.name || "None selected"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Order is from first hop (closest to you) to last hop before the exit.
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
                            className="text-xs gap-1 shrink-0"
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
                          <div className="border rounded-md divide-y max-h-[220px] overflow-y-auto">
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
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground"
                                      onClick={() => handleMoveChainProxy(index, -1)}
                                      disabled={index === 0}
                                    >
                                      <ChevronUp size={14} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground"
                                      onClick={() => handleMoveChainProxy(index, 1)}
                                      disabled={index === appSettings.proxy_chain.length - 1}
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
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="tls" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-6">
                <Card>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">TLS Fragmentation</div>
                        <div className="text-xs text-muted-foreground mt-2">
                          Split TLS records to bypass SNI blocking.
                        </div>
                      </div>
                      <Switch
                        checked={appSettings.tls_fragment}
                        onCheckedChange={(checked) =>
                          onSettingsChange("tls_fragment", checked)
                        }
                      />
                    </div>

                    {appSettings.tls_fragment && (
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                          <Label className="mb-1 block text-xs">Size Range</Label>
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
                          <Label className="mb-1 block text-xs">Sleep Range (ms)</Label>
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
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">TLS Mixed SNI Case</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Randomize SNI capitalization.
                      </div>
                    </div>
                    <Switch
                      checked={appSettings.tls_mixed_sni_case}
                      onCheckedChange={(checked) =>
                        onSettingsChange("tls_mixed_sni_case", checked)
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">TLS Padding</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Add random padding to TLS records.
                      </div>
                    </div>
                    <Switch
                      checked={appSettings.tls_padding}
                      onCheckedChange={(checked) =>
                        onSettingsChange("tls_padding", checked)
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">SNI Spoof</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Override SNI with a custom domain to bypass filtering.
                        </div>
                      </div>
                      <Switch
                        checked={appSettings.sni_spoof_enabled}
                        onCheckedChange={(checked) =>
                          onSettingsChange("sni_spoof_enabled", checked)
                        }
                      />
                    </div>

                    {appSettings.sni_spoof_enabled && (
                      <div className="pt-4 border-t">
                        <Label className="mb-1 block text-xs">Spoof Domain</Label>
                        <Input
                          type="text"
                          value={appSettings.sni_spoof_value}
                          onChange={(e) =>
                            onSettingsChange("sni_spoof_value", e.target.value)
                          }
                          placeholder="www.google.com"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Enter a domain that appears in SNI (e.g., www.google.com).
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="split-tunneling" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <Card>
                <CardContent className="space-y-4">
                  <div>
                    <div className="text-sm font-medium">Split Tunneling</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Choose which applications use the VPN.
                    </div>
                  </div>

                  <Tabs
                    defaultValue={appSettings.routing_mode}
                    onValueChange={(val) =>
                      onSettingsChange("routing_mode", val as "all" | "selected")
                    }
                    className="w-full"
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="all">All Apps</TabsTrigger>
                      <TabsTrigger value="selected">Selected Apps</TabsTrigger>
                    </TabsList>
                    <TabsContent value="all">
                      <div className="text-center py-4 border-2 border-dashed rounded-lg mt-2">
                        <p className="text-sm text-muted-foreground">
                          All applications will be routed through the VPN.
                        </p>
                      </div>
                    </TabsContent>
                    <TabsContent value="selected">
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Tunneled Applications</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={handleAddApp}
                          >
                            <Plus size={12} /> Add Application
                          </Button>
                        </div>

                        {appSettings.routing_apps.length === 0 ? (
                          <div className="text-center py-8 border-2 border-dashed rounded-lg">
                            <p className="text-sm text-muted-foreground">
                              No applications added.
                            </p>
                            <p className="text-xs text-muted-foreground/60 mt-1">
                              VPN traffic will be blocked for all apps.
                            </p>
                          </div>
                        ) : (
                          <div className="border rounded-md divide-y max-h-[200px] overflow-y-auto">
                            {appSettings.routing_apps.map((app) => (
                              <div
                                key={app}
                                className="flex items-center justify-between p-2 text-sm"
                              >
                                <span className="font-mono truncate mr-2">{app}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    onSettingsChange(
                                      "routing_apps",
                                      appSettings.routing_apps.filter((a) => a !== app)
                                    )
                                  }
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 pt-4 border-t">
                        <Label className="text-xs">Tunneled Domains</Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="google.com"
                            className="h-8 text-xs"
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddDomain();
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1 shrink-0"
                            onClick={handleAddDomain}
                          >
                            <Plus size={12} /> Add
                          </Button>
                        </div>

                        {appSettings.routing_domains.length > 0 && (
                          <div className="border rounded-md divide-y max-h-[150px] overflow-y-auto">
                            {appSettings.routing_domains.map((domain) => (
                              <div
                                key={domain}
                                className="flex items-center justify-between p-2 text-sm"
                              >
                                <span className="font-mono truncate mr-2">{domain}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    onSettingsChange(
                                      "routing_domains",
                                      appSettings.routing_domains.filter((d) => d !== domain)
                                    )
                                  }
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        {appSettings.routing_domains.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No specific domains added.
                          </p>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default SettingsView;

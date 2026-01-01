import { CheckCircle2, Laptop, Moon, RotateCw, Sun } from "lucide-react";

import { AppSettings } from "@/types";

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

type SettingsChangeHandler = <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
) => void;

interface SettingsViewProps {
  theme: string | undefined;
  setTheme: (value: string) => void;
  appSettings: AppSettings;
  onSettingsChange: SettingsChangeHandler;
  onConnectSync: () => void;
  onDisconnectSync: () => void;
}

function SettingsView({
  theme,
  setTheme,
  appSettings,
  onSettingsChange,
  onConnectSync,
  onDisconnectSync,
}: SettingsViewProps) {
  return (
      <div className="absolute inset-0">
        <ScrollArea className="h-full">
          <div className="px-12 py-4 flex flex-col pb-8">
        <header className="flex-none mb-8">
          <h1 className="text-3xl font-black tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure your client preferences
          </p>
        </header>

        <div className="space-y-6 pr-2">
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
                  <div className="text-sm font-medium">TLS Fragmentation</div>
                  <div className="text-xs text-muted-foreground mt-1">
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
      </div>
    </ScrollArea>
      </div>
  );
}

export default SettingsView;

import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AppSettings } from "@/types";

/**
 * Known client identities.
 *
 * Some providers only serve subscriptions to clients they recognise, so being
 * able to present as one of them is what makes those subscriptions work here.
 * `Happ/<version>` is the format Happ itself sends.
 */
const USER_AGENTS = [
    { value: "NuggetVPN/1.0", label: "NuggetVPN (default)" },
    { value: "Happ/3.13.0", label: "Happ" },
    { value: "v2rayNG/1.9.16", label: "v2rayNG" },
    { value: "Streisand", label: "Streisand" },
    { value: "Hiddify/2.0.5", label: "Hiddify" },
] as const;

const CUSTOM = "__custom__";

type SettingsChangeHandler = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
) => void;

interface Props {
    appSettings: AppSettings;
    onSettingsChange: SettingsChangeHandler;
    /** Asks the backend for a fresh device id. */
    onRegenerateHWID: () => void;
}

function SubscriptionIdentity({
    appSettings,
    onSettingsChange,
    onRegenerateHWID,
}: Props) {
    const known = USER_AGENTS.some(
        (agent) => agent.value === appSettings.subscription_user_agent
    );
    const [custom, setCustom] = useState(!known);
    const [copied, setCopied] = useState(false);

    const hwidOn = appSettings.hwid_enabled !== false;

    const copyHWID = async () => {
        try {
            await navigator.clipboard.writeText(appSettings.hwid);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be refused; the field is selectable anyway.
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardContent className="space-y-4">
                    <div>
                        <div className="text-sm font-medium">Client identity</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Sent when fetching a subscription. Some providers only
                            serve clients they recognise and answer with an error
                            for anything else.
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="user-agent">User agent</Label>
                        <Select
                            value={
                                custom
                                    ? CUSTOM
                                    : appSettings.subscription_user_agent
                            }
                            onValueChange={(value) => {
                                if (value === CUSTOM) {
                                    setCustom(true);
                                    return;
                                }
                                setCustom(false);
                                onSettingsChange("subscription_user_agent", value);
                            }}
                        >
                            <SelectTrigger id="user-agent">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {USER_AGENTS.map((agent) => (
                                    <SelectItem key={agent.value} value={agent.value}>
                                        {agent.label}
                                    </SelectItem>
                                ))}
                                <SelectItem value={CUSTOM}>Custom…</SelectItem>
                            </SelectContent>
                        </Select>

                        {custom ? (
                            <Input
                                value={appSettings.subscription_user_agent}
                                onChange={(event) =>
                                    onSettingsChange(
                                        "subscription_user_agent",
                                        event.target.value
                                    )
                                }
                                placeholder="Happ/3.13.0"
                                aria-label="Custom user agent"
                                className="font-mono text-xs"
                            />
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-sm font-medium">Device ID</div>
                            <div className="text-xs text-muted-foreground mt-1">
                                Providers that limit how many devices a subscription
                                may be used on count them by this id. Without it
                                they refuse the subscription outright, which looks
                                like a broken link. It is a random value for this
                                installation, not a hardware serial.
                            </div>
                        </div>
                        <Switch
                            checked={hwidOn}
                            onCheckedChange={(checked) =>
                                onSettingsChange("hwid_enabled", checked)
                            }
                            aria-label="Send a device ID"
                        />
                    </div>

                    {hwidOn ? (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="hwid">Device ID</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="hwid"
                                        value={appSettings.hwid}
                                        readOnly
                                        className="font-mono text-xs"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={copyHWID}
                                        aria-label="Copy device ID"
                                        title="Copy"
                                    >
                                        {copied ? (
                                            <Check size={14} aria-hidden="true" />
                                        ) : (
                                            <Copy size={14} aria-hidden="true" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={onRegenerateHWID}
                                        aria-label="Generate a new device ID"
                                        title="Generate a new one"
                                    >
                                        <RefreshCw size={14} aria-hidden="true" />
                                    </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Generating a new one looks like a new device to
                                    your provider, and may use up another slot.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="device-os">System</Label>
                                    <Input
                                        id="device-os"
                                        value={appSettings.device_os}
                                        onChange={(event) =>
                                            onSettingsChange("device_os", event.target.value)
                                        }
                                        placeholder="Windows"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="device-os-version">Version</Label>
                                    <Input
                                        id="device-os-version"
                                        value={appSettings.device_os_version}
                                        onChange={(event) =>
                                            onSettingsChange(
                                                "device_os_version",
                                                event.target.value
                                            )
                                        }
                                        placeholder="11"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="device-model">Model</Label>
                                    <Input
                                        id="device-model"
                                        value={appSettings.device_model}
                                        onChange={(event) =>
                                            onSettingsChange("device_model", event.target.value)
                                        }
                                        placeholder="Desktop"
                                    />
                                </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Only the ID is required. These just make the entry
                                readable in your provider&apos;s device list.
                            </p>
                        </>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}

export default SubscriptionIdentity;

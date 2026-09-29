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
import { useT } from "@/lib/i18n";
import { AppSettings } from "@/types";

/**
 * Known client identities.
 *
 * Some providers only serve subscriptions to clients they recognise, so being
 * able to present as one of them is what makes those subscriptions work here.
 * `Happ/<version>` is the format Happ itself sends.
 */
const USER_AGENTS = [
    { value: "NuggetVPN/1.0", label: "NuggetVPN" },
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
    const t = useT();
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
                        <div className="text-sm font-medium">{t("identity.title")}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {t("identity.description")}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="user-agent">{t("identity.userAgent")}</Label>
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
                                        {agent.value === "NuggetVPN/1.0"
                                            ? t("identity.defaultAgent", { name: agent.label })
                                            : agent.label}
                                    </SelectItem>
                                ))}
                                <SelectItem value={CUSTOM}>{t("identity.custom")}</SelectItem>
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
                                aria-label={t("identity.customLabel")}
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
                            <div className="text-sm font-medium">{t("identity.deviceId")}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                                {t("identity.deviceIdDescription")}
                            </div>
                        </div>
                        <Switch
                            checked={hwidOn}
                            onCheckedChange={(checked) =>
                                onSettingsChange("hwid_enabled", checked)
                            }
                            aria-label={t("identity.sendDeviceId")}
                        />
                    </div>

                    {hwidOn ? (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="hwid">{t("identity.deviceId")}</Label>
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
                                        aria-label={t("identity.copy")}
                                        title={t("identity.copy")}
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
                                        aria-label={t("identity.regenerate")}
                                        title={t("identity.regenerate")}
                                    >
                                        <RefreshCw size={14} aria-hidden="true" />
                                    </Button>
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    {t("identity.regenerateWarning")}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="device-os">{t("identity.system")}</Label>
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
                                    <Label htmlFor="device-os-version">{t("identity.version")}</Label>
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
                                    <Label htmlFor="device-model">{t("identity.model")}</Label>
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
                                {t("identity.optionalFields")}
                            </p>
                        </>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}

export default SubscriptionIdentity;

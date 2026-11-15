import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
    Code2,
    Download,
    Globe,
    Key,
    Loader2,
    Lock,
    Network,
    Save,
    Server,
    Shield,
    Sliders,
    Zap,
} from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import {
    defaultProxyFormState,
    parseProxyLink,
    ProxyFormState,
    serializeProxyConfig,
    canEditProxyForm,
} from "@/lib/proxy-config";
import { Profile } from "@/types";

interface EditProxyDialogProps {
    isOpen: boolean;
    onClose: () => void;
    profile: Profile | null;
    onSave: (id: string, name: string, configLink: string) => Promise<unknown>;
    onExport?: (profile: Profile) => void;
}

const SS_CIPHERS = [
    "2022-blake3-aes-128-gcm",
    "2022-blake3-aes-256-gcm",
    "2022-blake3-chacha20-poly1305",
    "aes-128-gcm",
    "aes-256-gcm",
    "chacha20-ietf-poly1305",
    "xchacha20-ietf-poly1305",
];

const FINGERPRINTS = [
    { value: "chrome", label: "Chrome" },
    { value: "firefox", label: "Firefox" },
    { value: "safari", label: "Safari" },
    { value: "ios", label: "iOS" },
    { value: "edge", label: "Edge" },
    { value: "qq", label: "QQ Browser" },
    { value: "random", label: "Random" },
];

export function EditProxyDialog({
    isOpen,
    onClose,
    profile,
    onSave,
    onExport,
}: EditProxyDialogProps) {
    const t = useT();
    const [open, setOpen] = useState(isOpen);
    const [cachedProfile, setCachedProfile] = useState<Profile | null>(profile);
    const closingRef = useRef(false);
    const [activeTab, setActiveTab] = useState<"form" | "raw">("form");
    const [form, setForm] = useState<ProxyFormState>(defaultProxyFormState());
    const [rawInput, setRawInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (profile && isOpen) {
            setOpen(true);
            setCachedProfile(profile);
            closingRef.current = false;
            const initialLink = profile.config_link || "";
            const parsed = parseProxyLink(initialLink, profile.name);
            setForm(parsed);
            setRawInput(initialLink);
            setActiveTab(canEditProxyForm(initialLink) ? "form" : "raw");
            setError("");
        }
    }, [profile, isOpen]);

    const activeProfile = profile || cachedProfile;
    if (!activeProfile) return null;

    const handleClose = () => {
        if (closingRef.current) return;
        closingRef.current = true;
        setOpen(false);
        setTimeout(() => {
            onClose();
            closingRef.current = false;
        }, 200);
    };

    const updateField = <K extends keyof ProxyFormState>(field: K, value: ProxyFormState[K]) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            const serialized = serializeProxyConfig(next);
            setRawInput(serialized);
            return next;
        });
    };

    const handleTabChange = (tab: string) => {
        if (tab === "form" && !canEditProxyForm(rawInput)) return;
        if (tab === "form" && activeTab === "raw") {
            try {
                const parsed = parseProxyLink(rawInput, form.name || activeProfile.name);
                setForm(parsed);
            } catch {
                // Keep existing form state if parse fails
            }
        } else if (tab === "raw" && activeTab === "form") {
            setRawInput(serializeProxyConfig(form));
        }
        setActiveTab(tab as "form" | "raw");
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");

        try {
            let finalLink = "";
            let finalName = "";

            if (activeTab === "raw") {
                finalLink = rawInput.trim();
                finalName = form.name.trim() || activeProfile.name;
                if (!finalLink) {
                    setError(t("ui.configRequired"));
                    setSaving(false);
                    return;
                }
            } else {
                if (!form.server.trim()) {
                    setError(t("ui.serverAddressRequired"));
                    setSaving(false);
                    return;
                }
                finalName = form.name.trim() || activeProfile.name;
                finalLink = serializeProxyConfig(form);
            }

            await onSave(activeProfile.id, finalName, finalLink);
            toast.success(t("ui.configSaved"), { id: "proxy-saved" });
            handleClose();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const proto = form.protocol.toLowerCase();
    const isVless = proto === "vless";
    const isVmess = proto === "vmess";
    const isTrojan = proto === "trojan";
    const isSS = proto === "ss" || proto === "shadowsocks";
    const isHy2 = proto === "hysteria2" || proto === "hy2";
    const isSocksOrHttp = proto === "socks" || proto === "socks5" || proto === "http" || proto === "https";

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : handleClose())}>
            <DialogContent className="sm:max-w-4xl lg:max-w-[940px] w-[95vw] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="p-4 pb-3 pe-10 border-b bg-card">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                            <Server size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-base font-semibold truncate">
                                {t("server.edit")}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground truncate">
                                {activeProfile.source_domain && activeProfile.source_domain !== "local"
                                    ? t("ui.providerDomain", { name: activeProfile.source_domain })
                                    : t("ui.individualProfiles")}
                            </DialogDescription>
                        </div>
                    </div>

                    {/* Full-width mode tabs */}
                    <Tabs
                        value={activeTab}
                        onValueChange={handleTabChange}
                        className="w-full pt-3"
                    >
                        <TabsList className="grid grid-cols-2 h-9 w-full">
                            <TabsTrigger value="form" disabled={!canEditProxyForm(rawInput)} className="text-xs gap-1.5 py-1.5">
                                <Sliders size={13} />
                                <span>{t("nav.settings")}</span>
                            </TabsTrigger>
                            <TabsTrigger value="raw" className="text-xs gap-1.5 py-1.5">
                                <Code2 size={13} />
                                <span>{t("ui.rawConfig")}</span>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </DialogHeader>

                {/* Body Content */}
                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                    {error && (
                        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                            {error}
                        </div>
                    )}

                    {activeTab === "form" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs items-start">
                            {/* LEFT COLUMN: Server, Credentials & Transport */}
                            <div className="space-y-4">
                                {/* Server & Connection */}
                                <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Globe size={14} className="text-primary" />
                                        <span>{t("ui.connectionPage")}</span>
                                    </div>
                                    <div className="space-y-2.5">
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-name" className="text-[11px] text-muted-foreground">
                                                {t("ui.configName")}
                                            </Label>
                                            <Input
                                                id="edit-name"
                                                value={form.name}
                                                onChange={(e) => updateField("name", e.target.value)}
                                                placeholder={t("add.namePlaceholder")}
                                                className="h-8.5 text-xs"
                                            />
                                        </div>
                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div className="col-span-2 space-y-1">
                                                <Label htmlFor="edit-server" className="text-[11px] text-muted-foreground">
                                                    {t("ui.serverAddress")}
                                                </Label>
                                                <Input
                                                    id="edit-server"
                                                    value={form.server}
                                                    onChange={(e) => updateField("server", e.target.value)}
                                                    placeholder="origin.example.com"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-port" className="text-[11px] text-muted-foreground">
                                                    {t("ui.port")}
                                                </Label>
                                                <Input
                                                    id="edit-port"
                                                    type="number"
                                                    value={form.port || ""}
                                                    onChange={(e) =>
                                                        updateField("port", parseInt(e.target.value, 10) || 443)
                                                    }
                                                    placeholder="443"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Credentials & Auth */}
                                <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Key size={14} className="text-primary" />
                                        <span>{t("ui.credentials")}</span>
                                    </div>

                                    {(isVless || isVmess) && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-uuid" className="text-[11px] text-muted-foreground">
                                                {t("ui.userId")}
                                            </Label>
                                            <Input
                                                id="edit-uuid"
                                                value={form.uuid}
                                                onChange={(e) => updateField("uuid", e.target.value)}
                                                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                                className="h-8.5 font-mono text-xs"
                                            />
                                        </div>
                                    )}

                                    {isVless && form.network === "tcp" && form.security !== "none" && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-flow" className="text-[11px] text-muted-foreground">{t("ui.flow")}</Label>
                                            <Select
                                                value={form.flow || "none"}
                                                onValueChange={(val) => updateField("flow", val === "none" ? "" : val ?? "")}
                                            >
                                                <SelectTrigger id="edit-flow" className="h-8.5 text-xs font-mono w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">{t("configuration.bulk.none")}</SelectItem>
                                                    <SelectItem value="xtls-rprx-vision">xtls-rprx-vision</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {isVmess && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-vmess-security" className="text-[11px] text-muted-foreground">{t("ui.encryption")}</Label>
                                                <Select
                                                    value={form.cipher || "auto"}
                                                    onValueChange={(val) => updateField("cipher", val ?? "auto")}
                                                >
                                                    <SelectTrigger id="edit-vmess-security" className="h-8.5 text-xs font-mono w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">{t("appearance.units.auto")}</SelectItem>
                                                        <SelectItem value="aes-128-gcm">aes-128-gcm</SelectItem>
                                                        <SelectItem value="chacha20-poly1305">chacha20-poly1305</SelectItem>
                                                        <SelectItem value="none">{t("configuration.bulk.none")}</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}

                                    {(isTrojan || isHy2 || isSS) && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-password" className="text-[11px] text-muted-foreground">
                                                {t("ui.passwordOrKey")}
                                            </Label>
                                            <Input
                                                id="edit-password"
                                                value={form.password}
                                                onChange={(e) => updateField("password", e.target.value)}
                                                placeholder={t("ui.password")}
                                                className="h-8.5 font-mono text-xs"
                                            />
                                        </div>
                                    )}

                                    {isSS && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-cipher" className="text-[11px] text-muted-foreground">{t("ui.encryption")}</Label>
                                            <Select
                                                value={form.cipher || "aes-256-gcm"}
                                                onValueChange={(val) => updateField("cipher", val ?? "auto")}
                                            >
                                                <SelectTrigger id="edit-cipher" className="h-8.5 text-xs font-mono w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {SS_CIPHERS.map((c) => (
                                                        <SelectItem key={c} value={c} className="font-mono text-xs">
                                                            {c}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {isSocksOrHttp && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-username" className="text-[11px] text-muted-foreground">
                                                    {t("ui.username")}
                                                </Label>
                                                <Input
                                                    id="edit-username"
                                                    value={form.username}
                                                    onChange={(e) => updateField("username", e.target.value)}
                                                    placeholder={t("ui.optional")}
                                                    className="h-8.5 text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-socks-pass" className="text-[11px] text-muted-foreground">
                                                    {t("ui.password")}
                                                </Label>
                                                <Input
                                                    id="edit-socks-pass"
                                                    value={form.password}
                                                    onChange={(e) => updateField("password", e.target.value)}
                                                    placeholder={t("ui.optional")}
                                                    className="h-8.5 text-xs"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Transport & Network */}
                                {(isVless || isVmess || isTrojan) && <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Network size={14} className="text-primary" />
                                        <span>{t("routing.source.network")}</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-network" className="text-[11px] text-muted-foreground">{t("ui.transportType")}</Label>
                                            <Select
                                                value={form.network}
                                                onValueChange={(val: "tcp" | "ws" | "grpc" | "http" | "httpupgrade" | null) =>
                                                    updateField("network", val ?? "tcp")
                                                }
                                            >
                                                <SelectTrigger id="edit-network" className="h-8.5 text-xs w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="tcp">TCP</SelectItem>
                                                    <SelectItem value="ws">WebSocket (ws)</SelectItem>
                                                    <SelectItem value="grpc">gRPC</SelectItem>
                                                    <SelectItem value="httpupgrade">HTTPUpgrade</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {form.network === "grpc" ? (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-service" className="text-[11px] text-muted-foreground">
                                                    {t("ui.grpcService")}
                                                </Label>
                                                <Input
                                                    id="edit-service"
                                                    value={form.serviceName}
                                                    onChange={(e) => updateField("serviceName", e.target.value)}
                                                    placeholder="grpc-service"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        ) : form.network !== "tcp" ? (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-path" className="text-[11px] text-muted-foreground">
                                                    {t("ui.path")}
                                                </Label>
                                                <Input
                                                    id="edit-path"
                                                    value={form.path}
                                                    onChange={(e) => updateField("path", e.target.value)}
                                                    placeholder="/ws"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        ) : null}
                                    </div>

                                    {(form.network === "ws" || form.network === "httpupgrade" || form.network === "http") && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-host" className="text-[11px] text-muted-foreground">
                                                {t("ui.hostHeader")}
                                            </Label>
                                            <Input
                                                id="edit-host"
                                                value={form.host}
                                                onChange={(e) => updateField("host", e.target.value)}
                                                placeholder="host.example.com"
                                                className="h-8.5 font-mono text-xs"
                                            />
                                        </div>
                                    )}
                                </div>}
                            </div>

                            {/* RIGHT COLUMN: Security, TLS & Reality */}
                            <div className="space-y-4">
                                {(isVless || isVmess || isTrojan || isHy2) && <div className="rounded-xl border bg-card/60 p-4 space-y-3.5 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Shield size={14} className="text-primary" />
                                        <span>{t("ui.tlsSecurity")}</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-tls" className="text-[11px] text-muted-foreground">{t("ui.securityMode")}</Label>
                                            <Select
                                                value={form.security}
                                                disabled={isHy2}
                                                onValueChange={(val: "none" | "tls" | "reality" | null) =>
                                                    updateField("security", val ?? "tls")
                                                }
                                            >
                                                <SelectTrigger id="edit-tls" className="h-8.5 text-xs w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">{t("ui.noSecurity")}</SelectItem>
                                                    <SelectItem value="tls">TLS</SelectItem>
                                                    {(isVless || isTrojan) && <SelectItem value="reality">Reality</SelectItem>}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {form.security !== "none" ? (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-sni" className="text-[11px] text-muted-foreground">
                                                    {t("ui.serverNameSni")}
                                                </Label>
                                                <Input
                                                    id="edit-sni"
                                                    value={form.sni}
                                                    onChange={(e) => updateField("sni", e.target.value)}
                                                    placeholder="dl.google.com"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        ) : null}
                                    </div>

                                    {form.security !== "none" && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {!isHy2 && <div className="space-y-1">
                                                <Label htmlFor="edit-fingerprint" className="text-[11px] text-muted-foreground">{t("ui.fingerprint")}</Label>
                                                <Select
                                                    value={form.fingerprint || "chrome"}
                                                    onValueChange={(val) => updateField("fingerprint", val ?? "chrome")}
                                                >
                                                    <SelectTrigger id="edit-fingerprint" className="h-8.5 text-xs w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {FINGERPRINTS.map((fp) => (
                                                            <SelectItem key={fp.value} value={fp.value}>
                                                                {fp.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>}

                                            {form.security === "tls" && <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-1.5">
                                                <div className="space-y-0.5">
                                                    <Label className="text-[11px] font-medium cursor-pointer">
                                                        {t("ui.skipCertCheck")}
                                                    </Label>
                                                    <p className="text-[9px] text-muted-foreground">
                                                        {t("ui.selfSigned")}
                                                    </p>
                                                </div>
                                                <Switch
                                                    aria-label={t("ui.skipCertCheck")}
                                                    checked={form.insecure}
                                                    onCheckedChange={(checked) => updateField("insecure", checked)}
                                                />
                                            </div>}
                                        </div>
                                    )}

                                    {/* Reality Parameters Box */}
                                    {form.security === "reality" && (
                                        <div className="rounded-lg border bg-muted/15 p-3 space-y-2.5">
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                                <Lock size={13} className="text-primary" />
                                                <span>{t("ui.realitySettings")}</span>
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-pbk" className="text-[11px] text-muted-foreground">
                                                    {t("ui.publicKey")}
                                                </Label>
                                                <Input
                                                    id="edit-pbk"
                                                    value={form.publicKey}
                                                    onChange={(e) => updateField("publicKey", e.target.value)}
                                                    placeholder={t("ui.publicKey")}
                                                    className="h-8 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <Label htmlFor="edit-sid" className="text-[11px] text-muted-foreground">
                                                        {t("ui.shortId")}
                                                    </Label>
                                                    <Input
                                                        id="edit-sid"
                                                        value={form.shortId}
                                                        onChange={(e) => updateField("shortId", e.target.value)}
                                                        placeholder="81ded0d6"
                                                        className="h-8 font-mono text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label htmlFor="edit-spx" className="text-[11px] text-muted-foreground">
                                                        SpiderX (spx)
                                                    </Label>
                                                    <Input
                                                        id="edit-spx"
                                                        value={form.spiderX}
                                                        onChange={(e) => updateField("spiderX", e.target.value)}
                                                        placeholder={t("ui.optional")}
                                                        className="h-8 font-mono text-xs"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>}

                                {isHy2 && (
                                    <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <Zap size={14} className="text-primary" />
                                            <span>{t("ui.hysteriaOptions")}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-obfs" className="text-[11px] text-muted-foreground">
                                                    {t("ui.obfsType")}
                                                </Label>
                                                <Input
                                                    id="edit-obfs"
                                                    value={form.obfs}
                                                    onChange={(e) => updateField("obfs", e.target.value)}
                                                    placeholder="salamander"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-obfs-pass" className="text-[11px] text-muted-foreground">
                                                    {t("ui.obfsPassword")}
                                                </Label>
                                                <Input
                                                    id="edit-obfs-pass"
                                                    value={form.obfsPassword}
                                                    onChange={(e) => updateField("obfsPassword", e.target.value)}
                                                    placeholder={t("ui.password")}
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="col-span-2 space-y-1">
                                                <Label htmlFor="edit-ports" className="text-[11px] text-muted-foreground">
                                                    {t("ui.portHopping")}
                                                </Label>
                                                <Input
                                                    id="edit-ports"
                                                    value={form.ports}
                                                    onChange={(e) => updateField("ports", e.target.value)}
                                                    placeholder="20000-40000"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="raw-config-textarea" className="text-xs font-medium">
                                    {t("ui.rawConfig")}
                                </Label>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                    vless://, vmess://, trojan://, ss://, hy2://, JSON
                                </span>
                            </div>
                            <Textarea
                                id="raw-config-textarea"
                                value={rawInput}
                                onChange={(e) => setRawInput(e.target.value)}
                                rows={14}
                                placeholder={t("ui.rawConfigHint")}
                                className="font-mono text-xs resize-y"
                                disabled={saving}
                            />
                            <p className="text-[11px] text-muted-foreground">
                                {t("ui.rawConfigHint")}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="p-4 border-t bg-card flex-row flex-wrap items-center justify-between gap-2 sm:justify-between">
                    <div>
                        {onExport ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    handleClose();
                                    onExport(activeProfile);
                                }}
                                className="gap-1.5 text-xs h-8"
                                disabled={saving}
                            >
                                <Download size={13} />
                                <span>{t("logs.export")}</span>
                            </Button>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleClose}
                            disabled={saving}
                            className="h-8 text-xs"
                        >
                            {t("common.cancel")}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving}
                            className="gap-1.5 h-8 text-xs"
                        >
                            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            <span>{t("common.save")}</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

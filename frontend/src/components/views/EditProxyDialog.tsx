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
            setActiveTab("form");
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
        if (tab === "form" && activeTab === "raw") {
            try {
                const parsed = parseProxyLink(rawInput, form.name || profile.name);
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
                    setError("Configuration cannot be empty");
                    setSaving(false);
                    return;
                }
            } else {
                if (!form.server.trim()) {
                    setError("Server address is required");
                    setSaving(false);
                    return;
                }
                finalName = form.name.trim() || activeProfile.name;
                finalLink = serializeProxyConfig(form);
            }

            await onSave(activeProfile.id, finalName, finalLink);
            toast.success("Proxy configuration saved", { id: "proxy-saved" });
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
    const isTuic = proto === "tuic";
    const isSocksOrHttp = proto === "socks" || proto === "socks5" || proto === "http" || proto === "https";

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : handleClose())}>
            <DialogContent className="sm:max-w-4xl lg:max-w-[940px] w-[95vw] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="p-5 pb-3 border-b bg-card">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                            <Server size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-base font-semibold truncate">
                                Edit Proxy Server
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground truncate">
                                {activeProfile.source_domain && activeProfile.source_domain !== "local"
                                    ? `Subscription: ${activeProfile.source_domain}`
                                    : "Custom Proxy Profile"}
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
                            <TabsTrigger value="form" className="text-xs gap-1.5 py-1.5">
                                <Sliders size={13} />
                                <span>Settings</span>
                            </TabsTrigger>
                            <TabsTrigger value="raw" className="text-xs gap-1.5 py-1.5">
                                <Code2 size={13} />
                                <span>Raw Link / Code</span>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </DialogHeader>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-5">
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
                                        <span>Server & Connection</span>
                                    </div>
                                    <div className="space-y-2.5">
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-name" className="text-[11px] text-muted-foreground">
                                                Display Name
                                            </Label>
                                            <Input
                                                id="edit-name"
                                                value={form.name}
                                                onChange={(e) => updateField("name", e.target.value)}
                                                placeholder="e.g. 🇳🇱 Netherlands 01"
                                                className="h-8.5 text-xs"
                                            />
                                        </div>
                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div className="col-span-2 space-y-1">
                                                <Label htmlFor="edit-server" className="text-[11px] text-muted-foreground">
                                                    Server Address / Host
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
                                                    Port
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
                                        <span>Credentials & Auth</span>
                                    </div>

                                    {(isVless || isVmess || isTuic) && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-uuid" className="text-[11px] text-muted-foreground">
                                                User ID (UUID)
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

                                    {isVless && (
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">
                                                Flow
                                            </Label>
                                            <Select
                                                value={form.flow || "none"}
                                                onValueChange={(val) => updateField("flow", val === "none" ? "" : val)}
                                            >
                                                <SelectTrigger className="h-8.5 text-xs font-mono w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">None</SelectItem>
                                                    <SelectItem value="xtls-rprx-vision">xtls-rprx-vision</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}

                                    {isVmess && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-alterid" className="text-[11px] text-muted-foreground">
                                                    AlterId
                                                </Label>
                                                <Input
                                                    id="edit-alterid"
                                                    type="number"
                                                    value={form.alterId || 0}
                                                    onChange={(e) =>
                                                        updateField("alterId", parseInt(e.target.value, 10) || 0)
                                                    }
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">
                                                    Security / Cipher
                                                </Label>
                                                <Select
                                                    value={form.cipher || "auto"}
                                                    onValueChange={(val) => updateField("cipher", val)}
                                                >
                                                    <SelectTrigger className="h-8.5 text-xs font-mono w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">auto</SelectItem>
                                                        <SelectItem value="aes-128-gcm">aes-128-gcm</SelectItem>
                                                        <SelectItem value="chacha20-poly1305">chacha20-poly1305</SelectItem>
                                                        <SelectItem value="none">none</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    )}

                                    {(isTrojan || isHy2 || isSS) && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-password" className="text-[11px] text-muted-foreground">
                                                Password / Key
                                            </Label>
                                            <Input
                                                id="edit-password"
                                                value={form.password}
                                                onChange={(e) => updateField("password", e.target.value)}
                                                placeholder="Authentication password"
                                                className="h-8.5 font-mono text-xs"
                                            />
                                        </div>
                                    )}

                                    {isSS && (
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">
                                                Encryption Method
                                            </Label>
                                            <Select
                                                value={form.cipher || "aes-256-gcm"}
                                                onValueChange={(val) => updateField("cipher", val)}
                                            >
                                                <SelectTrigger className="h-8.5 text-xs font-mono w-full">
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
                                                    Username
                                                </Label>
                                                <Input
                                                    id="edit-username"
                                                    value={form.username}
                                                    onChange={(e) => updateField("username", e.target.value)}
                                                    placeholder="Optional"
                                                    className="h-8.5 text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-socks-pass" className="text-[11px] text-muted-foreground">
                                                    Password
                                                </Label>
                                                <Input
                                                    id="edit-socks-pass"
                                                    value={form.password}
                                                    onChange={(e) => updateField("password", e.target.value)}
                                                    placeholder="Optional"
                                                    className="h-8.5 text-xs"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Transport & Network */}
                                <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Network size={14} className="text-primary" />
                                        <span>Transport & Network</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">
                                                Network Type
                                            </Label>
                                            <Select
                                                value={form.network}
                                                onValueChange={(val: "tcp" | "ws" | "grpc" | "http" | "httpupgrade") =>
                                                    updateField("network", val)
                                                }
                                            >
                                                <SelectTrigger className="h-8.5 text-xs w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="tcp">TCP</SelectItem>
                                                    <SelectItem value="ws">WebSocket (ws)</SelectItem>
                                                    <SelectItem value="grpc">gRPC</SelectItem>
                                                    <SelectItem value="httpupgrade">HTTPUpgrade</SelectItem>
                                                    <SelectItem value="http">HTTP / H2</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {form.network === "grpc" ? (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-service" className="text-[11px] text-muted-foreground">
                                                    gRPC Service Name
                                                </Label>
                                                <Input
                                                    id="edit-service"
                                                    value={form.serviceName}
                                                    onChange={(e) => updateField("serviceName", e.target.value)}
                                                    placeholder="grpc-service"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-path" className="text-[11px] text-muted-foreground">
                                                    Path
                                                </Label>
                                                <Input
                                                    id="edit-path"
                                                    value={form.path}
                                                    onChange={(e) => updateField("path", e.target.value)}
                                                    placeholder="/ or /ws"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {(form.network === "ws" || form.network === "httpupgrade" || form.network === "http") && (
                                        <div className="space-y-1">
                                            <Label htmlFor="edit-host" className="text-[11px] text-muted-foreground">
                                                Host Header (Optional)
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
                                </div>
                            </div>

                            {/* RIGHT COLUMN: Security, TLS & Reality */}
                            <div className="space-y-4">
                                <div className="rounded-xl border bg-card/60 p-4 space-y-3.5 shadow-xs">
                                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                        <Shield size={14} className="text-primary" />
                                        <span>Security & TLS</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        <div className="space-y-1">
                                            <Label className="text-[11px] text-muted-foreground">
                                                Security Mode
                                            </Label>
                                            <Select
                                                value={form.security}
                                                onValueChange={(val: "none" | "tls" | "reality") =>
                                                    updateField("security", val)
                                                }
                                            >
                                                <SelectTrigger className="h-8.5 text-xs w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">None (Plain)</SelectItem>
                                                    <SelectItem value="tls">TLS</SelectItem>
                                                    <SelectItem value="reality">Reality</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {form.security !== "none" ? (
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-sni" className="text-[11px] text-muted-foreground">
                                                    SNI / Server Name
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
                                            <div className="space-y-1">
                                                <Label className="text-[11px] text-muted-foreground">
                                                    uTLS Fingerprint
                                                </Label>
                                                <Select
                                                    value={form.fingerprint || "chrome"}
                                                    onValueChange={(val) => updateField("fingerprint", val)}
                                                >
                                                    <SelectTrigger className="h-8.5 text-xs w-full">
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
                                            </div>

                                            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-1.5">
                                                <div className="space-y-0.5">
                                                    <Label className="text-[11px] font-medium cursor-pointer">
                                                        Skip Cert Verify
                                                    </Label>
                                                    <p className="text-[9px] text-muted-foreground">
                                                        Allow self-signed certs
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={form.insecure}
                                                    onCheckedChange={(checked) => updateField("insecure", checked)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Reality Parameters Box */}
                                    {form.security === "reality" && (
                                        <div className="rounded-lg border bg-muted/15 p-3 space-y-2.5">
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                                <Lock size={13} className="text-primary" />
                                                <span>Reality Parameters</span>
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-pbk" className="text-[11px] text-muted-foreground">
                                                    Public Key (pbk)
                                                </Label>
                                                <Input
                                                    id="edit-pbk"
                                                    value={form.publicKey}
                                                    onChange={(e) => updateField("publicKey", e.target.value)}
                                                    placeholder="Reality public key"
                                                    className="h-8 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <Label htmlFor="edit-sid" className="text-[11px] text-muted-foreground">
                                                        Short ID (sid)
                                                    </Label>
                                                    <Input
                                                        id="edit-sid"
                                                        value={form.shortId}
                                                        onChange={(e) => updateField("shortId", e.target.value)}
                                                        placeholder="e.g. 81ded0d6"
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
                                                        placeholder="Optional"
                                                        className="h-8 font-mono text-xs"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {isHy2 && (
                                    <div className="rounded-xl border bg-card/60 p-4 space-y-3 shadow-xs">
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                            <Zap size={14} className="text-primary" />
                                            <span>Hysteria 2 Protocol Options</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label htmlFor="edit-obfs" className="text-[11px] text-muted-foreground">
                                                    Obfuscation Type
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
                                                    Obfs Password
                                                </Label>
                                                <Input
                                                    id="edit-obfs-pass"
                                                    value={form.obfsPassword}
                                                    onChange={(e) => updateField("obfsPassword", e.target.value)}
                                                    placeholder="Password"
                                                    className="h-8.5 font-mono text-xs"
                                                />
                                            </div>
                                            <div className="col-span-2 space-y-1">
                                                <Label htmlFor="edit-ports" className="text-[11px] text-muted-foreground">
                                                    Port Hopping Range
                                                </Label>
                                                <Input
                                                    id="edit-ports"
                                                    value={form.ports}
                                                    onChange={(e) => updateField("ports", e.target.value)}
                                                    placeholder="e.g. 20000-40000"
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
                                    Raw Configuration URI / JSON
                                </Label>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                    vless://, vmess://, trojan://, ss://, hy2:// or JSON
                                </span>
                            </div>
                            <Textarea
                                id="raw-config-textarea"
                                value={rawInput}
                                onChange={(e) => setRawInput(e.target.value)}
                                rows={14}
                                placeholder="Paste or edit raw URI/outbound configuration"
                                className="font-mono text-xs resize-y"
                                disabled={saving}
                            />
                            <p className="text-[11px] text-muted-foreground">
                                You can paste any standard proxy share link or sing-box outbound JSON object here.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="p-4 border-t bg-card flex-row items-center justify-between gap-2 sm:justify-between">
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
                                <span>Export…</span>
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
                            <span>Save Changes</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

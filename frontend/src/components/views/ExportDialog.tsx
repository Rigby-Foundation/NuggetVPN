import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Check, Copy, Download, FileCode, Loader2, Sparkles } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage, invoke, save, writeTextFile } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Profile } from "@/types";

export type ExportFormat = "singbox" | "clash" | "xray";

interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    profiles: Profile[];
    title?: string;
}

const FORMAT_CONFIG: Record<ExportFormat, { label: string; ext: string; mime: string; desc: string }> = {
    singbox: {
        label: "sing-box",
        ext: "json",
        mime: "application/json",
        desc: "Modern sing-box 1.11+ format (JSON)",
    },
    clash: {
        label: "Clash / Mihomo",
        ext: "yaml",
        mime: "text/yaml",
        desc: "Clash Meta / Mihomo compatible format (YAML)",
    },
    xray: {
        label: "Xray / V2Ray",
        ext: "json",
        mime: "application/json",
        desc: "Xray-core / V2Ray outbound & client format (JSON)",
    },
};

export function ExportDialog({ isOpen, onClose, profiles, title }: ExportDialogProps) {
    const t = useT();
    const [open, setOpen] = useState(isOpen);
    const closingRef = useRef(false);
    const [format, setFormat] = useState<ExportFormat>("singbox");
    const [fullConfig, setFullConfig] = useState(true);
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setOpen(true);
            closingRef.current = false;
        }
    }, [isOpen]);

    const handleClose = () => {
        if (closingRef.current) return;
        closingRef.current = true;
        setOpen(false);
        setTimeout(() => {
            onClose();
            closingRef.current = false;
        }, 200);
    };

    const ids = profiles.map((p) => p.id);

    useEffect(() => {
        if (!isOpen || profiles.length === 0) return;
        let cancelled = false;
        setLoading(true);
        setError("");

        invoke<string>("export_configs", {
            ids,
            format,
            full: fullConfig,
        })
            .then((result) => {
                if (!cancelled) {
                    setContent(result);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(errorMessage(err));
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, format, fullConfig, profiles]);

    const handleCopy = async () => {
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            toast.success("Configuration copied to clipboard", { id: "export-copy" });
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("Failed to copy configuration", { id: "export-copy-err" });
        }
    };

    const handleSaveFile = async () => {
        if (!content) return;
        const cfg = FORMAT_CONFIG[format];
        const defaultFilename = `nuggetvpn-${format}-${profiles.length}servers.${cfg.ext}`;

        setSaving(true);
        try {
            const path = await save({ defaultPath: defaultFilename });
            if (path) {
                await writeTextFile(path, content);
                toast.success(`Saved to ${path.split(/[\\/]/).pop()}`, { id: "export-save" });
                handleClose();
            }
        } catch (err) {
            toast.error(errorMessage(err), { id: "export-save-err" });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : handleClose())}>
            <DialogContent className="sm:max-w-2xl lg:max-w-3xl w-[95vw] max-h-[88vh] flex flex-col gap-4">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileCode size={18} className="text-primary" />
                        <span>{title || "Export Configuration"}</span>
                    </DialogTitle>
                    <DialogDescription>
                        Export proxy servers as ready-to-use sing-box, Clash, or Xray configuration files.
                    </DialogDescription>
                </DialogHeader>

                {/* Format Switcher Tabs */}
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1 border" role="tablist">
                    {(["singbox", "clash", "xray"] as const).map((fmt) => {
                        const cfg = FORMAT_CONFIG[fmt];
                        const active = format === fmt;
                        return (
                            <button
                                key={fmt}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setFormat(fmt)}
                                className={cn(
                                    "flex flex-col items-center justify-center py-2 px-3 rounded-lg text-xs transition-all",
                                    active
                                        ? "bg-background text-foreground font-semibold shadow-xs"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <span className="font-medium text-xs">{cfg.label}</span>
                                <span className="text-[10px] opacity-70 font-mono">.{cfg.ext}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Scope Options */}
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3.5 py-2.5 text-xs">
                    <div className="flex flex-col gap-0.5">
                        <Label htmlFor="full-config-toggle" className="text-xs font-medium cursor-pointer">
                            Complete Client Configuration
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                            {fullConfig
                                ? "Includes inbounds (mixed/socks/http), DNS hijacking and routing rules"
                                : "Outputs only outbounds / proxies array to paste into an existing file"}
                        </span>
                    </div>
                    <Switch
                        id="full-config-toggle"
                        checked={fullConfig}
                        onCheckedChange={setFullConfig}
                    />
                </div>

                {/* Live Code Preview Area */}
                <div className="relative flex-1 min-h-[220px] max-h-[380px] rounded-xl border bg-muted/20 font-mono text-xs overflow-hidden flex flex-col shadow-inner">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5 font-medium">
                            <Sparkles size={12} className="text-primary" />
                            {FORMAT_CONFIG[format].desc}
                        </span>
                        <span className="text-[10px]">
                            {content ? `${content.split("\n").length} lines` : ""}
                        </span>
                    </div>

                    <div className="flex-1 overflow-auto p-3">
                        {loading ? (
                            <div className="flex h-full min-h-[180px] items-center justify-center gap-2 text-muted-foreground">
                                <Loader2 size={18} className="animate-spin text-primary" />
                                <span>Generating {FORMAT_CONFIG[format].label} configuration…</span>
                            </div>
                        ) : error ? (
                            <div className="flex h-full min-h-[180px] flex-col items-center justify-center p-4 text-center text-status-error text-xs">
                                <span>Failed to generate configuration</span>
                                <span className="mt-1 font-mono text-[11px] text-muted-foreground">{error}</span>
                            </div>
                        ) : (
                            <pre className="whitespace-pre text-foreground font-mono text-xs select-text">
                                {content}
                            </pre>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between pt-1">
                    <Button variant="ghost" size="sm" onClick={handleClose} disabled={saving}>
                        {t("common.cancel")}
                    </Button>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={loading || !content || saving}
                            onClick={handleCopy}
                            className="gap-1.5"
                        >
                            {copied ? <Check size={14} className="text-status-connected" /> : <Copy size={14} />}
                            <span>{copied ? "Copied" : "Copy to Clipboard"}</span>
                        </Button>

                        <Button
                            variant="default"
                            size="sm"
                            disabled={loading || !content || saving}
                            onClick={handleSaveFile}
                            className="gap-1.5"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            <span>Save to File…</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

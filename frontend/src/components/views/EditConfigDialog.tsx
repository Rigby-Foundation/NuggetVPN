import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Download, Globe, Loader2, Save, Server } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { ConfigSource, Profile } from "@/types";

interface EditConfigDialogProps {
    isOpen: boolean;
    onClose: () => void;
    source: ConfigSource | null;
    profiles: Profile[];
    onUpdateSubscriptionUrl?: (domain: string, newUrl: string) => Promise<unknown>;
    onUpdateProfile?: (id: string, name: string, configLink: string) => Promise<unknown>;
    onExport?: (profiles: Profile[], title: string) => void;
}

export function EditConfigDialog({
    isOpen,
    onClose,
    source,
    profiles,
    onUpdateSubscriptionUrl,
    onUpdateProfile,
    onExport,
}: EditConfigDialogProps) {
    const t = useT();
    const [open, setOpen] = useState(isOpen);
    const [cachedSource, setCachedSource] = useState<ConfigSource | null>(source);
    const closingRef = useRef(false);
    const [url, setUrl] = useState("");
    const [name, setName] = useState("");
    const [link, setLink] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (source && isOpen) {
            setOpen(true);
            setCachedSource(source);
            closingRef.current = false;
            setError("");

            if (source.kind === "subscription") {
                const firstWithUrl = profiles.filter((p) => (p.source_domain || "").trim() === source.domain).find((p) => p.subscription_url);
                setUrl(firstWithUrl?.subscription_url || "");
                setName(source.label);
            } else {
                const localProfile = profiles.find((p) => p.id === source.profileId);
                if (localProfile) {
                    setName(localProfile.name || "");
                    setLink(localProfile.config_link || "");
                }
            }
        }
    }, [source, isOpen, profiles]);

    const activeSource = source || cachedSource;
    if (!activeSource) return null;

    const isSubscription = activeSource.kind === "subscription";
    const sourceProfiles = profiles.filter((p) => {
        if (activeSource.kind === "profile") {
            return p.id === activeSource.profileId;
        }
        const d = (p.source_domain || "").trim() || "local";
        return d === activeSource.domain;
    });

    const localProfile = activeSource.kind === "profile" ? profiles.find((p) => p.id === activeSource.profileId) : null;

    const handleClose = () => {
        if (closingRef.current) return;
        closingRef.current = true;
        setOpen(false);
        setTimeout(() => {
            onClose();
            closingRef.current = false;
        }, 200);
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");

        try {
            if (isSubscription) {
                const trimmedUrl = url.trim();
                if (!trimmedUrl) {
                    setError("Subscription URL cannot be empty");
                    setSaving(false);
                    return;
                }
                if (onUpdateSubscriptionUrl) {
                    await onUpdateSubscriptionUrl(activeSource.domain, trimmedUrl);
                    toast.success("Subscription URL updated", { id: "sub-url-updated" });
                }
            } else if (localProfile && onUpdateProfile) {
                const trimmedLink = link.trim();
                if (!trimmedLink) {
                    setError("Config link cannot be empty");
                    setSaving(false);
                    return;
                }
                await onUpdateProfile(localProfile.id, name.trim() || localProfile.name, trimmedLink);
                toast.success("Configuration updated", { id: "profile-updated" });
            }
            handleClose();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : handleClose())}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col gap-4">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isSubscription ? <Globe size={18} className="text-primary" /> : <Server size={18} className="text-primary" />}
                        <span>{isSubscription ? "Edit Subscription" : "Edit Configuration"}</span>
                    </DialogTitle>
                    <DialogDescription>
                        {isSubscription
                            ? "Update the subscription address or export all included servers."
                            : "Edit configuration parameters and credentials."}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-1">
                    {/* Name / Label */}
                    <div className="space-y-1.5">
                        <Label htmlFor="config-edit-name" className="text-xs font-medium">
                            Configuration Name
                        </Label>
                        <Input
                            id="config-edit-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={saving || isSubscription}
                            className="h-9 text-xs"
                        />
                        {isSubscription && (
                            <span className="text-[11px] text-muted-foreground">
                                Subscription provider domain: {source.domain}
                            </span>
                        )}
                    </div>

                    {/* Subscription URL */}
                    {isSubscription ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="config-edit-url" className="text-xs font-medium">
                                Subscription URL
                            </Label>
                            <Input
                                id="config-edit-url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://..."
                                className="h-9 font-mono text-xs"
                                disabled={saving}
                            />
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <Label htmlFor="config-edit-link" className="text-xs font-medium">
                                Configuration Link / Raw Outbound
                            </Label>
                            <Textarea
                                id="config-edit-link"
                                value={link}
                                onChange={(e) => setLink(e.target.value)}
                                rows={6}
                                className="font-mono text-xs resize-y"
                                disabled={saving}
                            />
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-2.5 text-xs text-status-error">
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between pt-1">
                    <div>
                        {onExport && sourceProfiles.length > 0 ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    handleClose();
                                    onExport(sourceProfiles, `Export ${activeSource.label}`);
                                }}
                                className="gap-1.5 text-xs"
                                disabled={saving}
                            >
                                <Download size={14} />
                                <span>Export ({sourceProfiles.length})…</span>
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
                        >
                            {t("common.cancel")}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving || (isSubscription ? !url.trim() : !link.trim())}
                            className="gap-1.5"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            <span>Save Changes</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

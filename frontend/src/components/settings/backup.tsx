import { useState } from "react";
import toast from "react-hot-toast";
import { Download, Loader2, Upload } from "lucide-react";

import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { AppSettings, Profile } from "@/types";

/**
 * What the window keeps itself, rather than the backend: the theme, the
 * custom themes and font choice, the language. A backup carries it too.
 */
function windowState(): Record<string, string> {
    const state: Record<string, string> = {};
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key && (key === "theme" || key.startsWith("nugget."))) {
                state[key] = localStorage.getItem(key) ?? "";
            }
        }
    } catch {
        // No storage: the backup carries the backend's part alone.
    }
    return state;
}

interface BackupResult {
    imported: boolean;
    settings: AppSettings;
    profiles: Profile[];
    ui?: Record<string, string> | null;
}

/**
 * Everything in one file — settings, servers and subscriptions, themes and
 * fonts, added pictures — to move to another computer or keep aside. This
 * device's sync sign-in and device id stay behind.
 */
export function BackupPanel() {
    const t = useT();
    const [busy, setBusy] = useState<"export" | "import" | null>(null);
    const [confirm, setConfirm] = useState(false);

    const exportBackup = async () => {
        setBusy("export");
        try {
            const path = await invoke<string>("export_backup", { ui: JSON.stringify(windowState()) });
            if (path) toast.success(t("backup.saved", { file: path.split(/[\\/]/).pop() ?? path }), { id: "backup" });
        } catch (error) {
            toast.error(errorMessage(error), { id: "backup" });
        } finally {
            setBusy(null);
        }
    };

    const importBackup = async () => {
        setConfirm(false);
        setBusy("import");
        try {
            const result = await invoke<BackupResult>("import_backup");
            if (!result.imported) return;
            // The window's own part goes back into storage, and a reload
            // brings everything up from the restored state at once.
            try {
                Object.entries(result.ui ?? {}).forEach(([key, value]) => {
                    if (key === "theme" || key.startsWith("nugget.")) localStorage.setItem(key, String(value));
                });
            } catch {
                // Storage unavailable: the backend's part is restored anyway.
            }
            window.location.reload();
        } catch (error) {
            toast.error(errorMessage(error), { id: "backup" });
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <SettingsGroup>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("backup.description")}</p>
                <SettingsField
                    label={t("backup.export")}
                    description={t("backup.export.description")}
                    control={
                        <Button size="sm" variant="outline" onClick={() => void exportBackup()} disabled={busy !== null}>
                            {busy === "export" ? (
                                <Loader2 size={14} className="me-2 animate-spin" aria-hidden="true" />
                            ) : (
                                <Download size={14} className="me-2" aria-hidden="true" />
                            )}
                            {t("backup.export.button")}
                        </Button>
                    }
                />
                <SettingsField
                    label={t("backup.import")}
                    description={t("backup.import.description")}
                    control={
                        <Button size="sm" variant="outline" onClick={() => setConfirm(true)} disabled={busy !== null}>
                            {busy === "import" ? (
                                <Loader2 size={14} className="me-2 animate-spin" aria-hidden="true" />
                            ) : (
                                <Upload size={14} className="me-2" aria-hidden="true" />
                            )}
                            {t("backup.import.button")}
                        </Button>
                    }
                />
            </SettingsGroup>

            {confirm ? (
                <Dialog open onOpenChange={(open) => (open ? undefined : setConfirm(false))}>
                    <DialogContent className="sm:max-w-sm">
                        <DialogHeader>
                            <DialogTitle>{t("backup.confirm.title")}</DialogTitle>
                            <DialogDescription>{t("backup.confirm.description")}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setConfirm(false)}>
                                {t("common.cancel")}
                            </Button>
                            <Button onClick={() => void importBackup()}>{t("backup.confirm.action")}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
        </>
    );
}

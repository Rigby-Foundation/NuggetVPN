import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveProfile: (name: string, link: string) => Promise<void>;
  onImportSubscription: (url: string) => Promise<void>;
}

function AddModal({
  isOpen,
  onClose,
  onSaveProfile,
  onImportSubscription,
}: AddModalProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [inputLink, setInputLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const isSubscription = /^https?:\/\//i.test(inputLink.trim());

  const handleProcess = async () => {
    const link = inputLink.trim();
    if (!link) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      if (isSubscription) {
        await onImportSubscription(link);
        handleClose();
        return;
      }

      const isJsonConfig = /^\s*\{/.test(link);
      const finalName = name || t(isJsonConfig ? "add.defaultJsonName" : "add.defaultName");
      await onSaveProfile(finalName, link);
      handleClose();
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setName("");
    setInputLink("");
    setErrorMsg("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="config-link">{t("add.linkLabel")}</Label>
            <Textarea
              id="config-link"
              value={inputLink}
              onChange={(e) => setInputLink(e.target.value)}
              placeholder={t("add.linkPlaceholder")}
              className="font-mono text-xs resize-none"
              rows={3}
            />
          </div>

          {!isSubscription && (
            <div className="grid gap-2">
              <Label htmlFor="profile-name">{t("add.nameLabel")}</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("add.namePlaceholder")}
              />
            </div>
          )}

          {errorMsg && (
            <div className="text-destructive text-xs p-2 bg-destructive/10 rounded border border-destructive/20">
              {errorMsg}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleProcess} disabled={isLoading}>
            {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isLoading
              ? t("common.working")
              : isSubscription
                ? t("add.importSubscription")
                : t("add.addProfile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddModal;

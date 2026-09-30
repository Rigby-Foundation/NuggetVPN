import { ClipboardEvent, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, QrCode, ScanLine } from "lucide-react";

import { decodeQrImage, QrScanner } from "@/components/qr";

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
import { isAndroid } from "@/lib/platform";

interface AddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveProfile: (name: string, link: string) => Promise<void>;
  onImportSubscription: (url: string) => Promise<void>;
  /** A link to start with: from a nuggetvpn:// link or the clipboard. */
  initialLink?: string;
}

function AddModal({
  isOpen,
  onClose,
  onSaveProfile,
  onImportSubscription,
  initialLink,
}: AddModalProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [inputLink, setInputLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [scanning, setScanning] = useState(false);
  const [camera, setCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && initialLink) setInputLink(initialLink);
  }, [isOpen, initialLink]);

  /** Fills the link from a QR code in an image: picked, dropped or pasted. */
  const scan = async (image: Blob) => {
    setScanning(true);
    setErrorMsg("");
    try {
      const text = await decodeQrImage(image);
      if (text) setInputLink(text);
      else setErrorMsg(t("add.qrNone"));
    } catch {
      setErrorMsg(t("add.qrNone"));
    } finally {
      setScanning(false);
    }
  };

  // Pasting a screenshot anywhere in the dialog scans it.
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"))?.getAsFile();
    if (image) {
      event.preventDefault();
      void scan(image);
    }
  };

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
      <DialogContent
        className="sm:max-w-md"
        onPaste={onPaste}
        // On a phone, focusing the field raised the keyboard over the dialog.
        onOpenAutoFocus={isAndroid ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="config-link">{t("add.linkLabel")}</Label>
              {/* On a phone the QR choices are full buttons under the field. */}
              {isAndroid ? null : <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanning}
                title={t("add.qrHint")}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                {scanning ? <Loader2 size={12} className="animate-spin" /> : <QrCode size={12} aria-hidden="true" />}
                {t("add.qr")}
              </button>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void scan(file);
                }}
              />
            </div>
            <Textarea
              id="config-link"
              value={inputLink}
              onChange={(e) => setInputLink(e.target.value)}
              placeholder={t("add.linkPlaceholder")}
              className="font-mono text-xs resize-none"
              rows={3}
            />
            {isAndroid ? (
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setCamera(true)}>
                  <ScanLine size={16} className="me-2" aria-hidden="true" />
                  {t("add.qrScan")}
                </Button>
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={scanning}>
                  {scanning ? (
                    <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImageIcon size={16} className="me-2" aria-hidden="true" />
                  )}
                  {t("add.qrImage")}
                </Button>
              </div>
            ) : null}
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
        {/* Inside this content, so Radix nests it rather than taking
            it for a click outside that closes this dialog. */}
        {camera ? (
          <QrScanner
            onClose={() => setCamera(false)}
            onResult={(text) => {
              setCamera(false);
              setErrorMsg("");
              setInputLink(text);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default AddModal;

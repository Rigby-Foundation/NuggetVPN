import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

/**
 * Reads a QR code out of an image — a screenshot of a provider's page, a
 * photo of a code. Resolves to the code's text, or null when the image has
 * none.
 */
export async function decodeQrImage(image: Blob): Promise<string | null> {
    const bitmap = await createImageBitmap(image);
    // Large screenshots are scaled down: jsQR's cost grows with the pixel
    // count, and a code is legible well below full resolution.
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height);
    const code = jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" });
    return code?.data?.trim() || null;
}

/** A link as a QR code, to scan with a phone, with a copy button. */
export function ShareDialog({ title, link, onClose }: { title: string; link: string; onClose: () => void }) {
    const t = useT();
    const [svg, setSvg] = useState("");
    const [tooLong, setTooLong] = useState(false);

    useEffect(() => {
        let cancelled = false;
        QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
            .then((markup) => {
                if (!cancelled) setSvg(markup);
            })
            // A link longer than a QR code can hold — a whole JSON config.
            .catch(() => {
                if (!cancelled) setTooLong(true);
            });
        return () => {
            cancelled = true;
        };
    }, [link]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            toast.success(t("share.copied"), { id: "share-copy" });
        } catch {
            toast.error(t("share.copyFailed"), { id: "share-copy" });
        }
    };

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="truncate">{title}</DialogTitle>
                    <DialogDescription>{t("share.explain")}</DialogDescription>
                </DialogHeader>
                {tooLong ? (
                    <p className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">{t("share.tooLong")}</p>
                ) : (
                    // Always black on white, whatever the theme: scanners
                    // expect a dark code on a light ground.
                    <div
                        className="mx-auto aspect-square w-64 overflow-hidden rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
                        role="img"
                        aria-label={t("share.qr")}
                        dangerouslySetInnerHTML={{ __html: svg }}
                    />
                )}
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-1.5 ps-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={link}>
                        {link}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => void copy()}>
                        <Copy size={13} className="me-1.5" aria-hidden="true" />
                        {t("share.copy")}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

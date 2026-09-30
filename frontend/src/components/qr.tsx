import { useEffect, useRef, useState } from "react";
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

/**
 * Opens the camera best suited to reading a code: the main back one.
 *
 * Asking for "environment" leaves the choice to the WebView, which on phones
 * with several back lenses can pick a macro or depth camera. On some of them
 * that camera cannot stream at all and the vendor's camera driver crashes
 * setting it up. So back cameras are tried in the order the system numbers
 * them (the main one comes first), then any other, until one opens.
 */
async function openCamera(): Promise<MediaStream> {
    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const attempt = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video: { ...size, ...video }, audio: false });
    const cameras = async () => {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput" && device.deviceId);
        const back = (device: MediaDeviceInfo) => /back|rear|environment/i.test(device.label);
        const number = (device: MediaDeviceInfo) => Number(/(\d+)/.exec(device.label)?.[1] ?? 99);
        return devices.sort((a, b) => Number(back(b)) - Number(back(a)) || number(a) - number(b));
    };

    let failure: unknown = new Error("no camera");
    let list = await cameras();
    if (!list.some((device) => device.label)) {
        // Cameras are named only once the page may use one. The default
        // camera is the system's first, the main back one on most phones;
        // keep it if it faces the back, or use it to learn the names.
        try {
            const stream = await attempt({});
            if (/back|rear|environment/i.test(stream.getVideoTracks()[0]?.label ?? "")) return stream;
            stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
            failure = error;
        }
        list = await cameras();
    }
    for (const device of list) {
        try {
            return await attempt({ deviceId: { exact: device.deviceId } });
        } catch (error) {
            failure = error;
        }
    }
    throw failure;
}

/**
 * Scans a QR code with the camera, the back one where there is a choice.
 * Frames are read a few times a second at a reduced size, which is plenty for
 * a code held in front of the lens; onResult is called once, with its text.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
    const t = useT();
    const videoRef = useRef<HTMLVideoElement>(null);
    const resultRef = useRef(onResult);
    resultRef.current = onResult;
    const [error, setError] = useState("");

    useEffect(() => {
        let stream: MediaStream | null = null;
        let timer = 0;
        let stopped = false;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });

        const read = () => {
            if (stopped) return;
            const video = videoRef.current;
            if (video && context && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
                const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
                const width = Math.round(video.videoWidth * scale);
                const height = Math.round(video.videoHeight * scale);
                canvas.width = width;
                canvas.height = height;
                context.drawImage(video, 0, 0, width, height);
                const code = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
                const text = code?.data?.trim();
                if (text) {
                    stopped = true;
                    resultRef.current(text);
                    return;
                }
            }
            timer = window.setTimeout(read, 150);
        };

        if (!navigator.mediaDevices?.getUserMedia) {
            setError(t("add.qrCameraError"));
        } else {
            openCamera()
                .then((opened) => {
                    if (stopped) {
                        opened.getTracks().forEach((track) => track.stop());
                        return;
                    }
                    stream = opened;
                    const video = videoRef.current;
                    if (video) {
                        video.srcObject = opened;
                        void video.play().catch(() => undefined);
                    }
                    read();
                })
                .catch((error: unknown) => {
                    console.warn("camera:", error instanceof Error ? `${error.name}: ${error.message}` : error);
                    setError(t("add.qrCameraError"));
                });
        }

        return () => {
            stopped = true;
            window.clearTimeout(timer);
            stream?.getTracks().forEach((track) => track.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="gap-3 p-4 sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("add.qrScanTitle")}</DialogTitle>
                    <DialogDescription>{t("add.qrScanHint")}</DialogDescription>
                </DialogHeader>
                <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
                    <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                    {error ? (
                        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">{error}</p>
                    ) : (
                        <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80" aria-hidden="true" />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
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

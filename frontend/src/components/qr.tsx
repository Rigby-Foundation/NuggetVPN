import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Copy, Loader2, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

async function copyText(text: string, done: string, failed: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(done, { id: "share-copy" });
    } catch {
        toast.error(failed, { id: "share-copy" });
    }
}

/** A link as a QR code, always dark on light: scanners expect that. */
function QrImage({ link }: { link: string }) {
    const t = useT();
    const [svg, setSvg] = useState("");
    const [tooLong, setTooLong] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setTooLong(false);
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

    return tooLong ? (
        <p className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">{t("share.tooLong")}</p>
    ) : (
        <div
            className="mx-auto aspect-square w-64 overflow-hidden rounded-lg bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
            role="img"
            aria-label={t("share.qr")}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

interface SharedLink {
    name: string;
    link: string;
}

/**
 * Each server on its own, as a vless://, vmess://… link: what a subscription
 * or a JSON config holds, for a client that takes single servers.
 */
function ServerLinks({ profileIds }: { profileIds: string[] }) {
    const t = useT();
    const [links, setLinks] = useState<SharedLink[] | null>(null);
    const [error, setError] = useState("");
    const [shown, setShown] = useState<number | null>(null);
    // The parent builds a fresh array on every render; read again only when
    // the profiles themselves change.
    const key = profileIds.join(",");

    useEffect(() => {
        let cancelled = false;
        invoke<SharedLink[]>("share_links", { ids: key ? key.split(",") : [] })
            .then((value) => {
                if (!cancelled) setLinks(value ?? []);
            })
            .catch((failure) => {
                if (!cancelled) setError(errorMessage(failure));
            });
        return () => {
            cancelled = true;
        };
    }, [key]);

    if (error) return <p className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">{error}</p>;
    if (!links) {
        return (
            <div className="grid place-items-center p-6 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            </div>
        );
    }
    if (links.length === 0) return <p className="rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">{t("share.servers.none")}</p>;

    return (
        <div className="space-y-2">
            {shown !== null && links[shown] ? <QrImage link={links[shown].link} /> : null}
            <ul className="max-h-72 space-y-1 overflow-y-auto">
                {links.map((item, index) => (
                    <li key={index} className={cn("flex items-center gap-1 rounded-lg border bg-muted/40 p-1 ps-3", shown === index && "border-primary/60")}>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{item.name || t("share.servers.unnamed")}</span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground" title={item.link} dir="ltr">
                                {item.link}
                            </span>
                        </span>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            aria-pressed={shown === index}
                            aria-label={t("share.qr")}
                            title={t("share.qr")}
                            onClick={() => setShown(shown === index ? null : index)}
                        >
                            <QrCode size={13} aria-hidden="true" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            aria-label={t("share.copy")}
                            title={t("share.copy")}
                            onClick={() => void copyText(item.link, t("share.copied"), t("share.copyFailed"))}
                        >
                            <Copy size={13} aria-hidden="true" />
                        </Button>
                    </li>
                ))}
            </ul>
            <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() =>
                    void copyText(
                        links.map((item) => item.link).join("\n"),
                        t("share.servers.copiedAll", { count: links.length }),
                        t("share.copyFailed")
                    )
                }
            >
                <Copy size={13} className="me-1.5" aria-hidden="true" />
                {t("share.servers.copyAll", { count: links.length })}
            </Button>
        </div>
    );
}

/**
 * A configuration to add elsewhere: the link it came from as a QR code and
 * text, and, given its profiles, each server's own link.
 */
export function ShareDialog({ title, link, profileIds, onClose }: { title: string; link: string; profileIds?: string[]; onClose: () => void }) {
    const t = useT();
    const [tab, setTab] = useState<"link" | "servers">("link");

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="truncate">{title}</DialogTitle>
                    <DialogDescription>{t(tab === "link" ? "share.explain" : "share.servers.explain")}</DialogDescription>
                </DialogHeader>
                {profileIds && profileIds.length > 0 ? (
                    <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted/60 p-0.5" role="tablist">
                        {(["link", "servers"] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                role="tab"
                                aria-selected={tab === option}
                                onClick={() => setTab(option)}
                                className={cn(
                                    "rounded-md py-1 text-xs transition-colors",
                                    tab === option ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t(option === "link" ? "share.tab.link" : "share.tab.servers")}
                            </button>
                        ))}
                    </div>
                ) : null}
                {tab === "servers" && profileIds ? (
                    <ServerLinks profileIds={profileIds} />
                ) : (
                    <>
                        <QrImage link={link} />
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-1.5 ps-3">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={link}>
                                {link}
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => void copyText(link, t("share.copied"), t("share.copyFailed"))}>
                                <Copy size={13} className="me-1.5" aria-hidden="true" />
                                {t("share.copy")}
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

import { useEffect, useState } from "react";

import { invoke } from "@/lib/backend";

/**
 * Subscription providers' images (logo, card background), as data URLs; the
 * backend downloads each once and keeps it (see app.GetBrandingImages). Kept
 * for the session here too, so a card drawn again draws at once.
 */
const cache = new Map<string, string>();
const asked = new Map<string, Promise<void>>();

export function useBrandingImage(url: string | undefined): string {
    const [, setVersion] = useState(0);
    useEffect(() => {
        if (!url || cache.has(url)) return;
        let live = true;
        let request = asked.get(url);
        if (!request) {
            request = invoke<Record<string, string>>("get_branding_images", { urls: [url] })
                .then((images) => void cache.set(url, images?.[url] ?? ""))
                .catch(() => void cache.set(url, ""));
            asked.set(url, request);
        }
        void request.then(() => live && setVersion((version) => version + 1));
        return () => {
            live = false;
        };
    }, [url]);
    return url ? cache.get(url) ?? "" : "";
}

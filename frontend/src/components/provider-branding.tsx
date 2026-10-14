import { ReactNode } from "react";

import { useBrandingImage } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { SubscriptionInfo } from "@/types";

/** The provider's logo where it sends one (icon-url), else the fallback. */
export function ProviderLogo({ info, className, fallback }: { info?: SubscriptionInfo; className?: string; fallback: ReactNode }) {
    const logo = useBrandingImage(info?.icon_url);
    if (!logo) return <>{fallback}</>;
    return <img src={logo} alt="" draggable={false} className={cn("shrink-0 object-contain", className)} />;
}

/**
 * The provider's card background (banner-image), drawn on the right of the
 * card and faded into it, under the card's content. The provider's own
 * guidance puts the artwork in the right half of a 1200×200 frame. The
 * parent isolates a stacking context, so it sits under everything there.
 */
export function ProviderBanner({ info }: { info?: SubscriptionInfo }) {
    const image = useBrandingImage(info?.banner_image);
    if (!image) return null;
    return (
        <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 end-0 -z-10 w-2/3 bg-cover bg-right opacity-50 [mask-image:linear-gradient(to_left,black_35%,transparent)] rtl:[mask-image:linear-gradient(to_right,black_35%,transparent)]"
            style={{ backgroundImage: `url("${image}")` }}
        />
    );
}

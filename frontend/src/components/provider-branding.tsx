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

/** The subscription's artwork, kept in its original proportions. */
export function ProviderBanner({ info }: { info?: SubscriptionInfo }) {
    const image = useBrandingImage(info?.banner_image);
    if (!image) return null;
    return (
        <img
            src={image}
            alt=""
            draggable={false}
            className="pointer-events-none h-auto max-h-32 w-full shrink-0 border-b border-border/60 bg-background/35 object-contain"
        />
    );
}

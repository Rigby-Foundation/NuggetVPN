import kageWordmark from "@/assets/kage.svg";
import { cn } from "@/lib/utils";

/** The supplied wordmark, tinted with the current theme's foreground color. */
export function BrandWordmark({ className }: { className?: string }) {
    const mask = `url("${kageWordmark}") center / contain no-repeat`;

    return (
        <span
            role="img"
            aria-label="Kage"
            className={cn("inline-block h-5 aspect-[141/32] shrink-0 align-middle bg-current", className)}
            style={{ mask, WebkitMask: mask }}
        />
    );
}

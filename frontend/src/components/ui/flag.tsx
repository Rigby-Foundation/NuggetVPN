import { Globe, Zap } from "lucide-react";

import { countryOf, flagUrl } from "@/lib/flags";
import { cn } from "@/lib/utils";

/**
 * A server's country as a round flag, read from its name; a neutral globe
 * when the name does not say. `auto` draws the automatic choice instead.
 */
export function Flag({
    name,
    auto = false,
    size = 28,
    className,
}: {
    name?: string;
    auto?: boolean;
    size?: number;
    className?: string;
}) {
    const code = !auto && name ? countryOf(name) : null;
    const url = code ? flagUrl(code) : undefined;
    const box = cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className
    );
    const style = { width: size, height: size };

    if (url) {
        return (
            <span className={cn(box, "ring-1 ring-black/10 dark:ring-white/15")} style={style}>
                <img src={url} alt="" aria-hidden="true" className="h-full w-full object-cover" draggable={false} />
            </span>
        );
    }
    const Icon = auto ? Zap : Globe;
    return (
        <span className={cn(box, auto ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")} style={style} aria-hidden="true">
            <Icon size={Math.round(size * 0.5)} />
        </span>
    );
}

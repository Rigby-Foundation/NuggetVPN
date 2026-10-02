import { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The settings shell.
 *
 * Settings used to be four tabs with every control stacked underneath, which
 * meant the tab strip had to grow with each new group and a setting was found
 * by reading the whole page. A list of named groups says what is inside each
 * one before you open it, and leaves room to add groups without redesigning
 * anything.
 */

interface RowProps {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    badge?: string;
    onClick: () => void;
}

export function SettingsRow({ icon: Icon, title, subtitle, badge, onClick }: RowProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "w-full flex items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5 text-start",
                "transition-colors hover:bg-accent/60"
            )}
        >
            <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground"
                aria-hidden="true"
            >
                <Icon size={16} />
            </span>

            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{title}</span>
                    {badge ? (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {badge}
                        </span>
                    ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {subtitle}
                </span>
            </span>

            <ChevronRight size={16} className="shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
        </button>
    );
}

/** A titled block of controls inside a section. */
export function SettingsGroup({
    title,
    description,
    children,
}: {
    title?: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-xl border bg-card/60 p-4 space-y-4">
            {title ? (
                <header>
                    <h3 className="text-sm font-medium">{title}</h3>
                    {description ? (
                        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                    ) : null}
                </header>
            ) : null}
            {children}
        </section>
    );
}

/** One labelled control with an explanation, laid out consistently. */
export function SettingsField({
    label,
    description,
    control,
    stacked = false,
}: {
    label: string;
    description?: string;
    control: ReactNode;
    /** Put the control under the label, for anything wider than a switch. */
    stacked?: boolean;
}) {
    if (stacked) {
        return (
            <div className="space-y-2">
                <div>
                    <div className="text-sm font-medium">{label}</div>
                    {description ? (
                        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
                    ) : null}
                </div>
                {control}
            </div>
        );
    }

    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {description ? (
                    <div className="mt-1 text-xs text-muted-foreground">{description}</div>
                ) : null}
            </div>
            <div className="shrink-0">{control}</div>
        </div>
    );
}

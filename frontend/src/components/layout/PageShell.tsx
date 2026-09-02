import { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface PageShellProps {
    title: string;
    description?: ReactNode;
    /** Buttons shown on the right of the header row. */
    actions?: ReactNode;
    children: ReactNode;
    /** Set for content that manages its own scrolling, like the log pane. */
    fill?: boolean;
    className?: string;
}

/**
 * The frame every view sits in.
 *
 * Each screen used to bring its own padding, heading size and scroll container,
 * so moving between them shifted the content by a few pixels and the headings
 * were three different sizes. One shell means one answer to all of that, and
 * one place to change it.
 */
function PageShell({
    title,
    description,
    actions,
    children,
    fill = false,
    className,
}: PageShellProps) {
    const header = (
        <header className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
                <h1 className="text-base font-semibold tracking-tight">{title}</h1>
                {description ? (
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                ) : null}
            </div>
            {actions ? (
                <div className="flex items-center gap-2 shrink-0">{actions}</div>
            ) : null}
        </header>
    );

    if (fill) {
        return (
            <div className={cn("absolute inset-0 flex flex-col px-6 py-5", className)}>
                {header}
                {children}
            </div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-hidden">
            <ScrollArea className="h-full">
                <div className={cn("px-6 py-5", className)}>
                    {header}
                    {children}
                </div>
            </ScrollArea>
        </div>
    );
}

export default PageShell;

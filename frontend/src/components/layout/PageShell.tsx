import { createContext, ReactNode, useContext } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useScrollMemory } from "@/lib/remember";
import { cn } from "@/lib/utils";

/**
 * Replaces a page's title with something else — the switcher of a screen made
 * of several pages, like Activity — without each page knowing it is in one.
 */
export const PageHeadingContext = createContext<ReactNode>(null);

interface PageShellProps {
    title: string;
    description?: ReactNode;
    /** Buttons shown on the right of the header row, or under it when narrow. */
    actions?: ReactNode;
    children: ReactNode;
    /** Set for content that manages its own scrolling, like the log pane. */
    fill?: boolean;
    className?: string;
    /** Remembers the scroll position under this name across tab switches. */
    memoryKey?: string;
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
    memoryKey,
}: PageShellProps) {
    const heading = useContext(PageHeadingContext);
    const scrollRef = useScrollMemory(fill ? undefined : memoryKey);
    const header = (
        // On a narrow screen the buttons go on a row of their own: beside the
        // title they left the description a word per line.
        <header className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
                {heading ?? <h1 className="text-base font-semibold tracking-tight">{title}</h1>}
                {description ? (
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                ) : null}
            </div>
            {actions ? (
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
            ) : null}
        </header>
    );

    // enter-stagger: the header and each top-level block animate in one after
    // another when the page opens. See "Entrance animations" in App.css.
    if (fill) {
        return (
            <div className={cn("enter-stagger absolute inset-0 flex flex-col px-6 py-5", className)}>
                {header}
                {children}
            </div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-hidden">
            <ScrollArea className="h-full" viewportRef={scrollRef}>
                <div className={cn("enter-stagger px-6 py-5", className)}>
                    {header}
                    {children}
                </div>
            </ScrollArea>
        </div>
    );
}

export default PageShell;

import { createContext, ReactNode, useContext } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useScrollMemory } from "@/lib/remember";
import { cn } from "@/lib/utils";

/**
 * Set by a screen made of several pages, like Activity, whose switcher stands
 * above them in place of a title: a page inside one drops its own title and
 * keeps its description and buttons. The switcher is outside the page, so
 * changing page replaces the page and leaves the switcher where it is.
 */
export const SubPageContext = createContext(false);

interface PageShellProps {
    title: string;
    description?: ReactNode;
    /** Navigation beside the title, including on narrow screens. */
    leading?: ReactNode;
    /** Buttons shown on the right of the header row, or under it when narrow. */
    actions?: ReactNode;
    children: ReactNode;
    /** Set for content that manages its own scrolling, like the log pane. */
    fill?: boolean;
    className?: string;
    /** Remembers the scroll position under this name across tab switches. */
    memoryKey?: string;
    width?: "standard" | "narrow" | "full";
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
    leading,
    actions,
    children,
    fill = false,
    className,
    memoryKey,
    width = "standard",
}: PageShellProps) {
    const widthClass = width === "narrow" ? "max-w-4xl" : width === "standard" ? "max-w-6xl" : "";
    const subPage = useContext(SubPageContext);
    const scrollRef = useScrollMemory(fill ? undefined : memoryKey);
    const header = (
        // On a narrow screen the buttons go on a row of their own: beside the
        // title they left the description a word per line.
        <header className={cn("flex flex-col gap-2 mb-3 sm:mb-5 sm:flex-row sm:justify-between sm:gap-4", subPage ? "sm:items-center" : "sm:items-start")}>
            <div className="flex min-w-0 items-start gap-2">
                {leading}
                <div className="min-w-0">
                    {subPage ? null : <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
                    {description ? (
                        <p className={cn("text-xs text-muted-foreground", !subPage && "mt-0.5")}>{description}</p>
                    ) : null}
                </div>
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
            <div className={cn("enter-stagger absolute inset-0 flex flex-col px-4 sm:px-6 pb-3 sm:pb-5", subPage ? "pt-2 sm:pt-3" : "pt-3 sm:pt-5", className)}>
                <div className={cn("mx-auto flex min-h-0 w-full flex-1 flex-col", widthClass)}>
                    {header}
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-hidden">
            <ScrollArea className="h-full" viewportRef={scrollRef}>
                <div className={cn("enter-stagger mx-auto w-full px-4 sm:px-6 pb-3 sm:pb-5", subPage ? "pt-2 sm:pt-3" : "pt-3 sm:pt-5", widthClass, className)}>
                    {header}
                    {children}
                </div>
            </ScrollArea>
        </div>
    );
}

export default PageShell;

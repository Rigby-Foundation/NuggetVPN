import { KeyboardEvent, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SelectableCardProps {
    selected?: boolean;
    onSelect: () => void;
    /** Announced to screen readers; the visible label is usually truncated. */
    label: string;
    children: ReactNode;
    className?: string;
}

/**
 * A card that behaves like the button it looks like.
 *
 * The proxy and configuration lists are the primary way to drive this app, and
 * they were plain divs with an onClick: not focusable, not reachable by
 * keyboard, and invisible to assistive technology. Giving them a role, a tab
 * stop, Enter/Space handling and a focus ring is the whole fix.
 */
function SelectableCard({
    selected = false,
    onSelect,
    label,
    children,
    className,
}: SelectableCardProps) {
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        // Space scrolls the page otherwise, which is jarring inside a list.
        event.preventDefault();
        onSelect();
    };

    return (
        <Card
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={label}
            onClick={onSelect}
            onKeyDown={handleKeyDown}
            className={cn(
                "cursor-pointer transition-colors py-0",
                "hover:border-primary/40",
                selected && "border-primary/70 bg-primary/5",
                className
            )}
        >
            {children}
        </Card>
    );
}

export default SelectableCard;

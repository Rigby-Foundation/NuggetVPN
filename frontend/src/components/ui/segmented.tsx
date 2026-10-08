import { KeyboardEvent, ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string | number> {
    value: T;
    label: ReactNode;
    icon?: ReactNode;
}

/**
 * A choice of a few, side by side, with a pill that slides to the chosen one.
 *
 * The pill is one element moved under the options rather than a background
 * on each, so a switch reads as a movement from here to there, and the
 * options themselves never change size.
 */
export function Segmented<T extends string | number>({
    options,
    value,
    onChange,
    label,
    size = "sm",
    className,
}: {
    options: readonly SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** What is being chosen, for screen readers. */
    label: string;
    size?: "sm" | "md";
    className?: string;
}) {
    const list = useRef<HTMLDivElement>(null);
    const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
    const index = options.findIndex((option) => option.value === value);

    // Measured, not computed: labels are different widths in every language.
    useLayoutEffect(() => {
        const element = list.current?.children[index + 1] as HTMLElement | undefined;
        if (!element) return;
        const measure = () => setPill({ left: element.offsetLeft, width: element.offsetWidth });
        measure();
        const resized = new ResizeObserver(measure);
        resized.observe(element);
        return () => resized.disconnect();
    }, [index, options]);

    const move = (event: KeyboardEvent) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        // Stop here: the app's own arrow keys switch screens.
        event.stopPropagation();
        // Right to left, the left arrow goes forward.
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        const sideways = event.key === "ArrowLeft" || event.key === "ArrowRight";
        const next = options[(index + (rtl && sideways ? -step : step) + options.length) % options.length];
        onChange(next.value);
        (list.current?.children[options.indexOf(next) + 1] as HTMLElement | undefined)?.focus();
    };

    return (
        <div
            ref={list}
            role="radiogroup"
            aria-label={label}
            onKeyDown={move}
            className={cn("relative inline-flex shrink-0 rounded-full bg-muted/60 p-0.5", className)}
        >
            <span
                aria-hidden="true"
                className={cn(
                    "absolute inset-y-0.5 rounded-full bg-background shadow-sm transition-[left,width] duration-200 ease-out",
                    !pill && "opacity-0"
                )}
                style={pill ?? undefined}
            />
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "relative z-10 flex items-center gap-1.5 rounded-full font-medium transition-colors",
                            size === "md" ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-xs",
                            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

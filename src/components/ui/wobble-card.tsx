// also some goofy ahh copy paste from rigby.host code
import React from "react";
import { cn } from "@/lib/utils";

export const WobbleCard = ({
    children,
    containerClassName,
    className,
    noiseOpacity
}: {
    children: React.ReactNode;
    containerClassName?: string;
    className?: string;
    noiseOpacity?: number;
}) => {
    return (
        <section
            className={cn(
                "mx-auto w-full bg-indigo-800 relative rounded-2xl overflow-hidden",
                containerClassName
            )}
        >
            <div
                className="relative h-full [background-image:radial-gradient(88%_100%_at_top,rgba(255,255,255,0.5),rgba(255,255,255,0))] sm:mx-0 sm:rounded-2xl overflow-hidden"
                style={{
                    boxShadow:
                        "0 10px 32px rgba(34, 42, 53, 0.12), 0 1px 1px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(34, 42, 53, 0.05), 0 4px 6px rgba(34, 42, 53, 0.08), 0 24px 108px rgba(47, 48, 55, 0.10)",
                }}
            >
                <div className={cn("h-full px-4 py-20 sm:px-10", className)}>
                    <Noise opacity={noiseOpacity} />
                    {children}
                </div>
            </div>
        </section>
    );
};

type NoiseProps = {
    className?: string
    image?: string
    size?: string | number
    opacity?: number
    maskRadius?: string
    style?: React.CSSProperties
}

export const Noise: React.FC<NoiseProps> = ({
    className,
    image = "/noise.webp",
    size = "30%",
    opacity = 0.1,
    maskRadius = "75%",
    style,
}) => {
    const sizeValue = typeof size === "number" ? `${size}%` : size

    return (
        <div
            aria-hidden
            role="presentation"
            className={cn(
                // базовые стили можно расширять своими классами через className
                "pointer-events-none absolute inset-0 w-full h-full scale-[1.2]",
                className
            )}
            style={{
                backgroundImage: `url(${image})`,
                backgroundSize: sizeValue,
                opacity,
                // маска для кросс-браузерности
                maskImage: `radial-gradient(#fff, transparent ${maskRadius})`,
                WebkitMaskImage: `radial-gradient(#fff, transparent ${maskRadius})`,
                ...style,
            }}
        />
    )
}
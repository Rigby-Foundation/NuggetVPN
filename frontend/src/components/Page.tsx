import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  hideTitle?: boolean;
}

export function Page({
  title,
  description,
  actions,
  children,
  className,
  hideTitle,
}: PageProps) {
  return (
    <section className={cn("flex flex-col gap-6 p-6", className)}>
      {!hideTitle && (
        <div data-page-part="0" className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

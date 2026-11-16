import { useState, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronDown, Search, type LucideIcon } from "lucide-react";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Keep the other workspaces on the same scale as the connection toolbar.
export function Workspace({
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  description: ReactNode;
  icon: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Page title={title} hideTitle className="min-h-full p-4 sm:p-6">
      <div className="flex flex-col gap-5 py-3 sm:px-4">
        <header data-page-part="0" className="flex items-center justify-between gap-3 compact:flex-wrap">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Glyph icon={Icon} />
            <div className="min-w-0 space-y-0.5">
              <h1 className="text-[15px] font-semibold">{title}</h1>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          {actions && (
            <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
        {children}
      </div>
    </Page>
  );
}

export function Glyph({
  icon: Icon,
  active = false,
}: {
  icon: LucideIcon;
  active?: boolean;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      <Icon
        className={cn(
          "size-[18px]",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
    </span>
  );
}

export function Surface({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-card/70",
        className,
      )}
      {...props}
    />
  );
}

export function ActionButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "h-10 gap-2 rounded-xl border-border/60 bg-card/70 px-3 text-[13px] hover:bg-accent/50",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label"> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={cn(
        "size-8 rounded-lg text-muted-foreground hover:text-foreground compact:size-10",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function Pill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 text-[13px] transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        {value}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 gap-0.5 p-1.5">
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{label}</p>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onChange(option);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            {option}
            {value === option && (
              <Check className="size-3.5 shrink-0 text-primary" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-9 min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 focus-within:ring-2 focus-within:ring-ring/50 sm:basis-0 compact:h-11 compact:basis-full">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Glyph icon={Icon} />
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

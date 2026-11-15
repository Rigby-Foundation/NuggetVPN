import type { ReactNode } from "react";

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
    <section className="settings-group space-y-3.5 rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
      {title || description ? (
        <header>
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {description ? (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
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
      <div
        className="space-y-2"
        data-slot="settings-field"
        role="group"
        aria-label={label}
      >
        <div>
          <div className="text-[13px] font-medium">{label}</div>
          {description ? (
            <div className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        <div className="max-w-xl">{control}</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      data-slot="settings-field"
      role="group"
      aria-label={label}
    >
      <div className="min-w-0 flex-1 basis-36">
        <div className="text-[13px] font-medium">{label}</div>
        {description ? (
          <div className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="max-w-full shrink-0">{control}</div>
    </div>
  );
}

import { useState } from "react";
import {
    ArrowRightLeft,
    Check,
    CircleAlert,
    CloudDownload,
    HardDrive,
    Loader2,
    PackageOpen,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { THEME_PRESETS } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { BeamItem, BeamMigrationReport, BeamOutcome, BeamPreview, BeamSubscription } from "@/types";

/**
 * Importing from Beam.
 *
 * The same panel serves the first-start offer and the Settings entry, so the
 * two can never describe the migration differently. It states up front what
 * comes across and what does not, because the one thing a migration must not
 * do is leave someone discovering later that a setting quietly vanished.
 */

interface PanelProps {
    preview: BeamPreview;
    /** Runs the import; the panel shows the outcome itself. */
    onImport: () => Promise<BeamMigrationReport>;
    /** Shown as "Not now" before importing, and "Continue" after. */
    onClose?: () => void;
    closeLabel?: string;
}

function expiry(seconds: number): string | null {
    if (!seconds) return null;
    const date = new Date(seconds * 1000);
    const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
    const when = date.toLocaleDateString();
    if (days < 0) return `expired ${when}`;
    return `until ${when}`;
}

function SubscriptionRow({ subscription }: { subscription: BeamSubscription }) {
    const facts = [
        subscription.host ? subscription.provider || subscription.host : "Added by hand",
        subscription.host ? expiry(subscription.expires_at) : `${subscription.cached_nodes} servers`,
        subscription.data_limit > 0
            ? `${formatBytes(subscription.data_used)} of ${formatBytes(subscription.data_limit)}`
            : null,
    ].filter(Boolean);

    return (
        <li className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background/60 text-muted-foreground">
                {subscription.host ? <CloudDownload size={15} /> : <HardDrive size={15} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                    {subscription.name || subscription.host || "Beam profile"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {facts.join(" · ")}
                </span>
            </span>
        </li>
    );
}

function ItemList({ items, tone }: { items: BeamItem[]; tone: "carried" | "skipped" }) {
    return (
        <ul className="space-y-1.5">
            {items.map((item) => (
                <li key={item.label + item.detail} className="flex gap-2 text-xs">
                    {tone === "carried" ? (
                        <Check size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                        <CircleAlert size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>
                        <span className="font-medium">{item.label}</span>
                        {item.detail ? <span className="text-muted-foreground"> — {item.detail}</span> : null}
                    </span>
                </li>
            ))}
        </ul>
    );
}

const OUTCOME_COPY: Record<BeamOutcome["source"], { label: string; good: boolean }> = {
    fetched: { label: "Up to date from the provider", good: true },
    local: { label: "Imported", good: true },
    cached: { label: "Beam's saved copy — the provider could not be reached", good: true },
    failed: { label: "Not imported", good: false },
};

function OutcomeRow({ outcome }: { outcome: BeamOutcome }) {
    const copy = OUTCOME_COPY[outcome.source];
    return (
        <li className="rounded-lg bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
                {copy.good ? (
                    <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />
                ) : (
                    <CircleAlert size={14} className="shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{outcome.name}</span>
                {outcome.profiles > 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {outcome.profiles} server{outcome.profiles === 1 ? "" : "s"}
                    </span>
                ) : null}
            </div>
            <p className="mt-1 pl-6 text-xs text-muted-foreground">{copy.label}</p>
            {outcome.note ? (
                <p className="mt-1 pl-6 text-xs text-muted-foreground break-words">{outcome.note}</p>
            ) : null}
        </li>
    );
}

export function BeamMigrationPanel({ preview, onImport, onClose, closeLabel = "Not now" }: PanelProps) {
    const [phase, setPhase] = useState<"offer" | "working" | "done">("offer");
    const [report, setReport] = useState<BeamMigrationReport | null>(null);
    const [error, setError] = useState("");

    const theme = THEME_PRESETS.find((preset) => preset.id === preview.theme);
    const carried: BeamItem[] = [
        ...preview.carried,
        ...(theme ? [{ label: "Theme", detail: theme.label }] : []),
    ];

    const run = async () => {
        setPhase("working");
        setError("");
        try {
            setReport(await onImport());
            setPhase("done");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setPhase("offer");
        }
    };

    if (phase === "done" && report) {
        const total = report.outcomes.reduce((sum, outcome) => sum + outcome.profiles, 0);
        return (
            <div className="space-y-4">
                <p className="text-sm">
                    {total > 0
                        ? `Imported ${total} server${total === 1 ? "" : "s"}.`
                        : "Nothing could be imported."}{" "}
                    <span className="text-muted-foreground">Beam's own files were not changed.</span>
                </p>
                <ul className="space-y-2">
                    {report.outcomes.map((outcome) => (
                        <OutcomeRow key={outcome.name + outcome.host} outcome={outcome} />
                    ))}
                </ul>
                {onClose ? (
                    <Button className="w-full" onClick={onClose}>
                        Continue
                    </Button>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {preview.subscriptions.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Subscriptions
                    </h4>
                    <ul className="space-y-2">
                        {preview.subscriptions.map((subscription, index) => (
                            <SubscriptionRow key={index} subscription={subscription} />
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                        Each is fetched fresh from its provider, using Beam's device id so it
                        counts as the same device. Beam's saved servers are the fallback if a
                        provider can't be reached.
                    </p>
                </section>
            ) : null}

            {carried.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Comes across
                    </h4>
                    <ItemList items={carried} tone="carried" />
                </section>
            ) : null}

            {preview.skipped.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Stays behind
                    </h4>
                    <ItemList items={preview.skipped} tone="skipped" />
                </section>
            ) : null}

            {error ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            ) : null}

            <div className={cn("flex gap-2", onClose ? "" : "justify-end")}>
                {onClose ? (
                    <Button variant="ghost" className="flex-1" onClick={onClose} disabled={phase === "working"}>
                        {closeLabel}
                    </Button>
                ) : null}
                <Button className={onClose ? "flex-1 gap-2" : "gap-2"} onClick={run} disabled={phase === "working"}>
                    {phase === "working" ? (
                        <>
                            <Loader2 size={15} className="animate-spin" /> Importing…
                        </>
                    ) : (
                        <>
                            <ArrowRightLeft size={15} /> Import from Beam
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

/** The first-start offer, over the whole window. */
export function BeamMigrationDialog({
    preview,
    onImport,
    onClose,
}: {
    preview: BeamPreview;
    onImport: () => Promise<BeamMigrationReport>;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 p-6 backdrop-blur-2xl">
            <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border bg-card shadow-2xl">
                <header className="flex items-start gap-3 p-6 pb-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <PackageOpen size={20} />
                    </span>
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">Found Beam on this computer</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            Bring your subscriptions and settings across instead of setting up again.
                        </p>
                    </div>
                </header>
                <div className="min-h-0 overflow-y-auto px-6 pb-6">
                    <BeamMigrationPanel preview={preview} onImport={onImport} onClose={onClose} />
                </div>
            </div>
        </div>
    );
}

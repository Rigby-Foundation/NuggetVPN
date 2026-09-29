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
import { fontLabel, MOTIONS, RADII } from "@/lib/appearance";
import { MessageKey, Translate, useI18n, useT } from "@/lib/i18n";
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
}

/** Each item key from Go, as a title and an explanation. */
const ITEM_COPY: Record<string, { title: MessageKey; detail?: MessageKey }> = {
    device_id: { title: "beam.item.deviceId", detail: "beam.item.deviceIdKept" },
    device_id_invalid: { title: "beam.item.deviceId", detail: "beam.item.deviceIdInvalid" },
    device_headers_off: { title: "beam.item.deviceHeaders", detail: "beam.item.deviceHeadersOff" },
    client_identity: { title: "beam.item.clientIdentity" },
    dns: { title: "beam.item.dns" },
    mtu: { title: "beam.item.mtu" },
    split_exclude: { title: "beam.item.split", detail: "beam.item.splitExclude" },
    split_include: { title: "beam.item.split", detail: "beam.item.splitInclude" },
    split_mode_unknown: { title: "beam.item.split", detail: "beam.item.splitModeUnknown" },
    split_existing: { title: "beam.item.split", detail: "beam.item.splitExisting" },
    advanced_graph: { title: "beam.item.advancedGraph", detail: "beam.item.advancedGraphDetail" },
    theme_unknown: { title: "beam.item.theme", detail: "beam.item.themeUnknown" },
    unreadable: { title: "beam.item.unreadable" },
};

/** An item as the title and detail to show. */
function describe(t: Translate, item: BeamItem): { title: string; detail?: string } {
    const copy = ITEM_COPY[item.key];
    if (!copy) {
        return { title: item.key, detail: item.value };
    }
    const params = { value: item.value ?? "", count: item.count ?? 0 };
    return {
        title: t(copy.title),
        // Without its own sentence, the item's detail is its value.
        detail: copy.detail ? t(copy.detail, params) : item.value,
    };
}

function SubscriptionRow({ subscription }: { subscription: BeamSubscription }) {
    const { t, language } = useI18n();
    const expires = (() => {
        if (!subscription.host || !subscription.expires_at) return null;
        const date = new Date(subscription.expires_at * 1000);
        const when = date.toLocaleDateString(language);
        const expired = date.getTime() < Date.now();
        return { text: t(expired ? "beam.expired" : "beam.until", { date: when }), expired };
    })();
    const facts = [
        subscription.host ? subscription.provider || subscription.host : t("beam.addedByHand"),
        subscription.host ? null : t("beam.servers", { count: subscription.cached_nodes }),
        subscription.data_limit > 0
            ? t("beam.usage", {
                  used: formatBytes(subscription.data_used),
                  limit: formatBytes(subscription.data_limit),
              })
            : null,
    ].filter(Boolean);

    return (
        <li className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background/60 text-muted-foreground">
                {subscription.host ? <CloudDownload size={15} /> : <HardDrive size={15} />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                    {subscription.name || subscription.host || t("beam.profile")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {facts.join(" · ")}
                    {expires ? (
                        // An expired subscription usually serves placeholder
                        // entries instead of servers, so importing it will not
                        // produce anything that connects until it is renewed.
                        <span className={expires.expired ? "text-destructive" : undefined}>
                            {" · "}
                            {expires.text}
                        </span>
                    ) : null}
                </span>
            </span>
        </li>
    );
}

function ItemList({
    items,
    tone,
}: {
    items: { title: string; detail?: string }[];
    tone: "carried" | "skipped";
}) {
    return (
        <ul className="space-y-1.5">
            {items.map((item) => (
                <li key={item.title + item.detail} className="flex gap-2 text-xs">
                    {tone === "carried" ? (
                        <Check size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                        <CircleAlert size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>
                        <span className="font-medium">{item.title}</span>
                        {item.detail ? <span className="text-muted-foreground"> — {item.detail}</span> : null}
                    </span>
                </li>
            ))}
        </ul>
    );
}

const OUTCOME_COPY: Record<BeamOutcome["source"], { label: MessageKey; good: boolean }> = {
    fetched: { label: "beam.outcome.fetched", good: true },
    local: { label: "beam.outcome.local", good: true },
    cached: { label: "beam.outcome.cached", good: true },
    failed: { label: "beam.outcome.failed", good: false },
};

function OutcomeRow({ outcome }: { outcome: BeamOutcome }) {
    const t = useT();
    const copy = OUTCOME_COPY[outcome.source];
    const notes = [
        outcome.no_servers ? t("beam.outcome.noServers") : null,
        outcome.error ?? null,
        outcome.shared_host ? t("beam.outcome.sharedHost") : null,
    ].filter(Boolean);
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
                        {t("beam.servers", { count: outcome.profiles })}
                    </span>
                ) : null}
            </div>
            <p className="mt-1 ps-6 text-xs text-muted-foreground">{t(copy.label)}</p>
            {notes.map((note) => (
                <p key={note} className="mt-1 ps-6 text-xs text-muted-foreground break-words">
                    {note}
                </p>
            ))}
        </li>
    );
}

export function BeamMigrationPanel({ preview, onImport, onClose }: PanelProps) {
    const t = useT();
    const [phase, setPhase] = useState<"offer" | "working" | "done">("offer");
    const [report, setReport] = useState<BeamMigrationReport | null>(null);
    const [error, setError] = useState("");

    const theme = THEME_PRESETS.find((preset) => preset.id === preview.theme);
    const { font, radius, motion } = preview.appearance ?? { font: "", radius: "", motion: "" };
    const radiusOption = RADII.find((option) => option.id === radius);
    const motionOption = MOTIONS.find((option) => option.id === motion);
    const look = [
        [t("beam.item.theme"), theme ? t(theme.label) : null],
        [t("appearance.font"), font ? fontLabel(t, font) : null],
        [t("appearance.corners"), radiusOption ? t(radiusOption.label) : null],
        [t("appearance.motion"), motionOption ? t(motionOption.label) : null],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
    const carried = [
        ...preview.carried.map((item) => describe(t, item)),
        ...look.map(([title, detail]) => ({ title, detail })),
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
                    {total > 0 ? t("beam.imported", { count: total }) : t("beam.importedNothing")}{" "}
                    <span className="text-muted-foreground">{t("beam.untouched")}</span>
                </p>
                <ul className="space-y-2">
                    {report.outcomes.map((outcome) => (
                        <OutcomeRow key={outcome.name + outcome.host} outcome={outcome} />
                    ))}
                </ul>
                {onClose ? (
                    <Button className="w-full" onClick={onClose}>
                        {t("common.continue")}
                    </Button>
                ) : null}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {preview.subscriptions.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">{t("beam.subscriptions")}</h4>
                    <ul className="space-y-2">
                        {preview.subscriptions.map((subscription, index) => (
                            <SubscriptionRow key={index} subscription={subscription} />
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">{t("beam.fetchNote")}</p>
                </section>
            ) : null}

            {carried.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">{t("beam.carried")}</h4>
                    <ItemList items={carried} tone="carried" />
                </section>
            ) : null}

            {preview.skipped.length > 0 ? (
                <section className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground">{t("beam.skipped")}</h4>
                    <ItemList items={preview.skipped.map((item) => describe(t, item))} tone="skipped" />
                </section>
            ) : null}

            {error ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            ) : null}

            <div className={cn("flex gap-2", onClose ? "" : "justify-end")}>
                {onClose ? (
                    <Button variant="ghost" className="flex-1" onClick={onClose} disabled={phase === "working"}>
                        {t("beam.notNow")}
                    </Button>
                ) : null}
                <Button className={onClose ? "flex-1 gap-2" : "gap-2"} onClick={run} disabled={phase === "working"}>
                    {phase === "working" ? (
                        <>
                            <Loader2 size={15} className="animate-spin" /> {t("beam.importing")}
                        </>
                    ) : (
                        <>
                            <ArrowRightLeft size={15} /> {t("beam.import")}
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
    const t = useT();
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 p-6 backdrop-blur-2xl">
            <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border bg-card shadow-2xl">
                <header className="flex items-start gap-3 p-6 pb-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <PackageOpen size={20} />
                    </span>
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">{t("beam.found")}</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">{t("beam.foundHint")}</p>
                    </div>
                </header>
                <div className="min-h-0 overflow-y-auto px-6 pb-6">
                    <BeamMigrationPanel preview={preview} onImport={onImport} onClose={onClose} />
                </div>
            </div>
        </div>
    );
}

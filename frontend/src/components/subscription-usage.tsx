import { ExternalLink, LifeBuoy } from "lucide-react";

import { openExternal } from "@/lib/backend";
import { formatBytes } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SubscriptionInfo } from "@/types";

const DAY = 24 * 60 * 60 * 1000;

/** How close a subscription is to running out: of days, or of data. */
export function subscriptionAlert(info: SubscriptionInfo | undefined, now = Date.now()) {
    if (!info) return null;
    const used = info.upload + info.download;
    if (info.expire > 0 && info.expire * 1000 <= now) return "expired" as const;
    if (info.total > 0 && used >= info.total) return "exhausted" as const;
    if (info.expire > 0 && info.expire * 1000 - now < 3 * DAY) return "expiring" as const;
    if (info.total > 0 && used / info.total >= 0.9) return "low" as const;
    return null;
}


/**
 * A subscription's data and time left, as its provider reports them: a bar
 * for the data, the expiry date, and the provider's support and account
 * links when it sends them.
 */
export function SubscriptionUsage({ info }: { info: SubscriptionInfo }) {
    const { t, language } = useI18n();
    const now = Date.now();
    const used = info.upload + info.download;
    const share = info.total > 0 ? Math.min(1, used / info.total) : 0;
    const alert = subscriptionAlert(info, now);
    const warn = alert === "expiring" || alert === "low";
    const bad = alert === "expired" || alert === "exhausted";

    const expiry = (() => {
        if (!info.expire) return t("usage.noExpiry");
        const date = new Date(info.expire * 1000).toLocaleDateString(language, { dateStyle: "medium" });
        const days = Math.ceil((info.expire * 1000 - now) / DAY);
        if (days <= 0) return t("usage.expired", { date });
        return t("usage.expires", { date, count: days });
    })();

    return (
        <div className="mt-2.5 space-y-1.5" onClick={(event) => event.stopPropagation()}>
            {info.total > 0 ? (
                <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(share * 100)}
                    aria-label={t("usage.data")}
                >
                    <div
                        className={cn(
                            "h-full rounded-full transition-[width]",
                            bad ? "bg-status-error" : warn ? "bg-status-connecting" : "bg-primary"
                        )}
                        style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                    />
                </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                    {info.total > 0
                        ? t("usage.of", { used: formatBytes(used), total: formatBytes(info.total) })
                        : t("usage.unlimited", { used: formatBytes(used) })}
                </span>
                <span className={cn(bad ? "text-status-error" : warn ? "text-status-connecting" : "")}>{expiry}</span>
                {info.support_url ? (
                    <button
                        type="button"
                        onClick={() => openExternal(info.support_url!)}
                        className="flex items-center gap-1 hover:text-foreground"
                    >
                        <LifeBuoy size={11} aria-hidden="true" />
                        {t("usage.support")}
                    </button>
                ) : null}
                {info.web_page_url ? (
                    <button
                        type="button"
                        onClick={() => openExternal(info.web_page_url!)}
                        className="flex items-center gap-1 hover:text-foreground"
                    >
                        <ExternalLink size={11} aria-hidden="true" />
                        {t("usage.account")}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

import { useState } from "react";
import { ChevronDown, ChevronUp, Info, Link2, Send, X } from "lucide-react";

import { openExternal } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SubscriptionInfo } from "@/types";

const DISMISSED_KEY = "nugget.announce.dismissed";

/** A short stable key for a message, so dismissing one does not hide the next. */
function keyOf(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return String(hash);
}

function loadDismissed(): string[] {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
        return [];
    }
}

/**
 * A subscription's announcement: the message its provider sends with it
 * (the "announce" header, or an "#announce:" line in the body). It can be
 * folded to its first line, or dismissed until the provider says something
 * new.
 */
export function AnnounceBanner({ info }: { info?: SubscriptionInfo }) {
    const t = useT();
    const [dismissed, setDismissed] = useState(loadDismissed);
    const [folded, setFolded] = useState(false);

    const text = info?.announce?.trim();
    if (!text || dismissed.includes(keyOf(text))) return null;

    const link = info?.announce_url || info?.support_url;
    const telegram = link ? /^tg:|\/\/(t\.me|telegram\.me)\//i.test(link) : false;
    const LinkIcon = telegram ? Send : Link2;
    const multiline = text.includes("\n");

    const dismiss = () => {
        // Only the latest few are kept; old messages do not come back anyway.
        const next = [...dismissed, keyOf(text)].slice(-20);
        setDismissed(next);
        try {
            localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
        } catch {
            // Dismissed for this run only.
        }
    };

    const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

    return (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-3 sm:p-4" role="status">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Info size={18} />
            </span>
            <p
                className={cn(
                    "min-w-0 flex-1 self-center whitespace-pre-line break-words text-sm leading-relaxed",
                    folded && "line-clamp-1"
                )}
            >
                {text}
            </p>
            <div className="flex shrink-0 items-center">
                {multiline ? (
                    <button
                        type="button"
                        onClick={() => setFolded((value) => !value)}
                        aria-label={t(folded ? "announce.expand" : "announce.collapse")}
                        title={t(folded ? "announce.expand" : "announce.collapse")}
                        className={iconButton}
                    >
                        {folded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
                    </button>
                ) : null}
                {link ? (
                    <button
                        type="button"
                        onClick={() => openExternal(link)}
                        aria-label={t("announce.open")}
                        title={link}
                        className={iconButton}
                    >
                        <LinkIcon size={16} />
                    </button>
                ) : null}
                <button type="button" onClick={dismiss} aria-label={t("announce.dismiss")} title={t("announce.dismiss")} className={iconButton}>
                    <X size={17} />
                </button>
            </div>
        </div>
    );
}

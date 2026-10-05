import { useState } from "react";
import { MoreHorizontal, Power, Settings, Signal, Waypoints } from "lucide-react";

import { TABS } from "@/components/layout/AppSidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MessageKey, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The screens with a place of their own in the bar; the rest are under More. */
const PRIMARY = [
    { id: "connection", label: "nav.connection", icon: Power },
    { id: "proxies", label: "nav.proxies", icon: Signal },
    { id: "routing", label: "nav.routing", icon: Waypoints },
    { id: "settings", label: "nav.settings", icon: Settings },
] as const satisfies readonly { id: string; label: MessageKey; icon: unknown }[];

const PRIMARY_IDS = new Set<string>(PRIMARY.map((tab) => tab.id));

/**
 * Navigation on a phone, or a window too narrow for the sidebar: the four
 * screens used most along the bottom, within reach of a thumb, and the others
 * one tap further under More.
 */
export function BottomNav({
    activeTab,
    onTabChange,
}: {
    activeTab: string;
    onTabChange: (tab: string) => void;
}) {
    const t = useT();
    const [more, setMore] = useState(false);
    const others = TABS.filter((tab) => !PRIMARY_IDS.has(tab.id));
    const inMore = !PRIMARY_IDS.has(activeTab);

    const item = (active: boolean) =>
        cn(
            "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] transition-colors",
            active ? "text-primary" : "text-muted-foreground"
        );

    return (
        <>
            <nav
                className="flex shrink-0 items-stretch gap-1 border-t bg-background px-2 pt-1"
                style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
                aria-label={t("nav.menu")}
            >
                {PRIMARY.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        aria-current={activeTab === tab.id ? "page" : undefined}
                        className={item(activeTab === tab.id)}
                    >
                        <span className={cn("grid h-7 w-14 place-items-center rounded-full transition-colors", activeTab === tab.id && "bg-primary/15")}>
                            <tab.icon size={19} aria-hidden="true" />
                        </span>
                        <span className="truncate">{t(tab.label)}</span>
                    </button>
                ))}
                <button type="button" onClick={() => setMore(true)} aria-expanded={more} className={item(inMore)}>
                    <span className={cn("grid h-7 w-14 place-items-center rounded-full transition-colors", inMore && "bg-primary/15")}>
                        <MoreHorizontal size={19} aria-hidden="true" />
                    </span>
                    <span className="truncate">{t("nav.more")}</span>
                </button>
            </nav>

            <Sheet open={more} onOpenChange={setMore}>
                <SheetContent side="bottom" className="rounded-t-2xl pb-6">
                    <SheetHeader>
                        <SheetTitle>{t("nav.more")}</SheetTitle>
                    </SheetHeader>
                    <div className="grid grid-cols-2 gap-2 px-4">
                        {others.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                    onTabChange(tab.id);
                                    setMore(false);
                                }}
                                className={cn(
                                    "flex items-center gap-3 rounded-xl border p-3 text-start text-sm transition-colors",
                                    activeTab === tab.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50"
                                )}
                            >
                                <tab.icon size={18} aria-hidden="true" />
                                {t(tab.label)}
                            </button>
                        ))}
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}

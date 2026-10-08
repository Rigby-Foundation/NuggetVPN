import { ReactNode } from "react";
import { BarChart3, FileText, Waypoints } from "lucide-react";

import { SubPageContext } from "@/components/layout/PageShell";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";
import { useRemembered } from "@/lib/remember";
import { ActivityPage } from "@/lib/tabs";

/**
 * Statistics, Connections and Logs as one screen.
 *
 * The switcher sits above the pages in place of a title; each page keeps its
 * own description and buttons (see SubPageContext). It opens on Statistics,
 * and on whichever page was open last after that.
 */
export default function ActivityView({ pages }: { pages: Record<ActivityPage, ReactNode> }) {
    const t = useT();
    const [page, setPage] = useRemembered<ActivityPage>("activity.page", "statistics");
    const switcher = (
        <Segmented<ActivityPage>
            size="md"
            label={t("nav.activity")}
            value={page}
            onChange={setPage}
            options={[
                { value: "statistics", label: t("stats.title"), icon: <BarChart3 size={14} aria-hidden="true" /> },
                { value: "connections", label: t("connections.title"), icon: <Waypoints size={14} aria-hidden="true" /> },
                { value: "logs", label: t("logs.title"), icon: <FileText size={14} aria-hidden="true" /> },
            ]}
        />
    );
    return (
        <div className="absolute inset-0 flex flex-col">
            {/* The switcher stays put, like the navigation: only the page under it changes. */}
            <div className="shrink-0 px-6 pt-5">{switcher}</div>
            <div className="relative min-h-0 flex-1">
                <SubPageContext.Provider value={true}>
                    {/* Keyed so a page plays its entrance when switched to. */}
                    <div key={page} className="contents">
                        {pages[page]}
                    </div>
                </SubPageContext.Provider>
            </div>
        </div>
    );
}

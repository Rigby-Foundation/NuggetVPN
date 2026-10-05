import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NAV_TABS } from "./UnifiedHeader";

interface BottomDockNavProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export function BottomDockNav({ activeTab, onTabChange }: BottomDockNavProps) {
    const { t } = useI18n();

    return (
        <nav
            className="z-20 flex shrink-0 items-center justify-center border-t border-border/40 bg-card/75 backdrop-blur-md px-3 pt-2 select-none"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
            aria-label={t("nav.menu")}
        >
            <div className="flex items-center gap-1 sm:gap-1.5 rounded-2xl border border-border/50 bg-muted/40 p-1 backdrop-blur-xs max-w-full overflow-x-auto shadow-xs">
                {NAV_TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <Tooltip key={tab.id} delayDuration={250}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => onTabChange(tab.id)}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-xl text-xs transition-all duration-150 select-none shrink-0",
                                        isActive
                                            ? "bg-background text-foreground shadow-xs font-semibold px-3 py-1.5"
                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground px-2.5 py-1.5"
                                    )}
                                >
                                    <Icon size={15} className={isActive ? "text-primary" : "text-muted-foreground"} />
                                    <span className={cn("truncate", isActive ? "inline max-w-[100px]" : "hidden sm:inline max-w-[85px]")}>
                                        {t(tab.label)}
                                    </span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                {t(tab.label)}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </nav>
    );
}

export default BottomDockNav;

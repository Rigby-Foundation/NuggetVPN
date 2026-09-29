import { Plus, RefreshCw, Trash2 } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import SelectableCard from "@/components/ui/selectable-card";
import { cn } from "@/lib/utils";
import { LOCAL } from "@/hooks/use-profiles";
import { useT } from "@/lib/i18n";
import { ConfigSource } from "@/types";

interface ConfigurationViewProps {
    sources: ConfigSource[];
    selectedSource: string;
    selectedProfileId: string;
    refreshingSourceDomain: string;
    onSelectSource: (source: ConfigSource) => void;
    onDeleteSource: (source: ConfigSource) => void;
    onRefreshSource: (source: ConfigSource) => void;
    onAdd: () => void;
}

function ConfigurationView({
    sources,
    selectedSource,
    selectedProfileId,
    refreshingSourceDomain,
    onSelectSource,
    onDeleteSource,
    onRefreshSource,
    onAdd,
}: ConfigurationViewProps) {
    const t = useT();
    const detailOf = (source: ConfigSource) =>
        source.kind === "subscription" ? t("sources.proxies", { count: source.count }) : source.detail;
    const isSelected = (source: ConfigSource) =>
        source.kind === "subscription"
            ? selectedSource === source.domain
            : selectedSource === LOCAL && selectedProfileId === source.profileId;

    return (
        <PageShell
            title={t("configuration.title")}
            description={t("configuration.description")}
            actions={
                sources.length > 0 ? (
                    <Button size="sm" variant="outline" onClick={onAdd}>
                        <Plus size={14} className="me-2" aria-hidden="true" />
                        {t("configuration.add")}
                    </Button>
                ) : null
            }
        >
            {sources.length === 0 ? (
                <div className="rounded-lg border border-dashed py-14 px-6 text-center">
                    <p className="text-sm font-medium">{t("configuration.emptyTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                        {t("configuration.emptyHint")}
                    </p>
                    <Button onClick={onAdd}>
                        <Plus size={16} className="me-2" aria-hidden="true" />
                        {t("configuration.emptyButton")}
                    </Button>
                </div>
            ) : (
                <div className="enter-stagger space-y-2">
                    {sources.map((source) => {
                        const domain =
                            source.kind === "subscription"
                                ? (source.domain || "").trim() || LOCAL
                                : LOCAL;
                        const refreshing =
                            source.kind === "subscription" &&
                            refreshingSourceDomain === domain;

                        return (
                            <SelectableCard
                                key={source.key}
                                selected={isSelected(source)}
                                onSelect={() => onSelectSource(source)}
                                label={`${source.label}, ${detailOf(source)}`}
                                className="group"
                            >
                                <div className="p-4 flex items-center gap-2">
                                    <span className="flex-1 min-w-0">
                                        <span className="block font-medium truncate">
                                            {source.label}
                                        </span>
                                        <span className="block text-xs text-muted-foreground font-mono mt-0.5 truncate">
                                            {detailOf(source)}
                                        </span>
                                    </span>

                                    {source.kind === "subscription" ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t("configuration.refresh", { name: source.label })}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onRefreshSource(source);
                                            }}
                                            disabled={refreshing}
                                            className="shrink-0"
                                        >
                                            <RefreshCw
                                                size={16}
                                                className={cn(refreshing && "animate-spin")}
                                                aria-hidden="true"
                                            />
                                        </Button>
                                    ) : null}

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t("configuration.delete", { name: source.label })}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDeleteSource(source);
                                        }}
                                        className="shrink-0 hover:text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                    </Button>
                                </div>
                            </SelectableCard>
                        );
                    })}
                </div>
            )}
        </PageShell>
    );
}

export default ConfigurationView;

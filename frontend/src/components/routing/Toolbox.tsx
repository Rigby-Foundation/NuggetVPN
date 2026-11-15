import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Database,
  GripVertical,
  Layers2,
  Plus,
  Search,
  Server,
  StickyNote,
  WandSparkles,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/routing/controls";
import {
  PresetList,
  type PresetPlacement,
  type PresetRule,
} from "@/components/routing/presets";
import { kindMeta } from "@/components/routing/nodes";
import { useT } from "@/lib/i18n";
import {
  RULE_GUIDE,
  DESTINATIONS,
  ruleGroups,
} from "@/components/routing/guide";
import { useRemembered } from "@/lib/remember";
import { cn } from "@/lib/utils";
import { isIOS } from "@/lib/platform";
import { useVpn } from "@/app/vpn-context";
import type { Profile, RoutingAction, RoutingKind } from "@/types";
export interface ToolboxProps {
  onAddSource: (kind: RoutingKind) => void;
  onAddNote: () => void;
  onAddServer: (id: string) => void;
  onAddPreset: (rules: PresetRule[], placement: PresetPlacement) => void;
  hiddenActions: RoutingAction[];
  onShowAction: (action: RoutingAction) => void;
  profiles: Profile[];
  placedServers: string[];
  geoPanel: ReactNode;
  orderPanel: ReactNode;
  className?: string;
}
const kinds = ([
  "apps",
  "domains",
  "ip",
  "geosite",
  "geoip",
  "ruleset",
  "port",
  "protocol",
  "network",
  "logical",
] satisfies RoutingKind[]).filter((kind) => !isIOS || kind !== "apps");
export function RoutingToolbox({
  onAddSource,
  onAddNote,
  onAddServer,
  onAddPreset,
  hiddenActions,
  onShowAction,
  profiles,
  placedServers,
  geoPanel,
  orderPanel,
  className,
}: ToolboxProps) {
  const t = useT();
  const { unsupportedProfiles } = useVpn();
  const [tab, setTab] = useRemembered("routing.toolbox", "build");
  const [query, setQuery] = useState("");
  const available = profiles.filter(
    (profile) => !placedServers.includes(profile.id) && !unsupportedProfiles[profile.id],
  );
  return (
    <aside
      data-page-part="2"
      className={cn(
        "routing-toolbox flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/65",
        className,
      )}
      aria-label={t("routing.ui.tool")}
    >
      <header className="shrink-0 px-4 pt-4 pb-3">
        <h2 className="text-[13px] font-semibold">{t("routing.ui.tool")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("routing.ui.toolHint")}
        </p>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList
          aria-label={t("routing.ui.tool")}
          className="mx-3 mb-3 grid h-9! w-auto grid-cols-3 rounded-xl bg-muted/50"
        >
          <TabsTrigger value="build" className="rounded-lg text-xs">
            <Layers2 className="size-3.5" />
            {t("routing.ui.build")}
          </TabsTrigger>
          <TabsTrigger value="priority" className="rounded-lg text-xs">
            <GripVertical className="size-3.5" />
            {t("routing.ui.priority")}
          </TabsTrigger>
          <TabsTrigger value="data" className="rounded-lg text-xs">
            <Database className="size-3.5" />
            {t("routing.ui.data")}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="build"
          className="nowheel min-h-0 overflow-y-auto border-t border-border/60 p-3"
        >
          <label className="mb-4 flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-background/30 px-2.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              aria-label={t("routing.ui.search")}
              placeholder={t("routing.ui.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
          {ruleGroups.map((group) => {
            const matches = kinds.filter(
              (kind) =>
                RULE_GUIDE[kind].group === group &&
                `${t(RULE_GUIDE[kind].title)} ${t(RULE_GUIDE[kind].description)} ${kind === "domains" ? t("routing.source.regex.hint") : ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            );
            return matches.length ? (
              <section key={group} className="mb-4">
                <h3 className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                  {t(`routing.ui.${group}`)}
                </h3>
                {matches.map((kind) => {
                  const guide = RULE_GUIDE[kind];
                  const meta = kindMeta(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => onAddSource(kind)}
                      className="group flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          color: meta.accent,
                          background: `color-mix(in srgb, ${meta.accent} 10%, transparent)`,
                        }}
                      >
                        <meta.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">
                          {t(guide.title)}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                          {t(guide.short)}
                        </span>
                      </span>
                      <Plus className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  );
                })}
              </section>
            ) : null;
          })}
          {query &&
            !kinds.some((kind) =>
              `${t(RULE_GUIDE[kind].title)} ${t(RULE_GUIDE[kind].description)} ${kind === "domains" ? t("routing.source.regex.hint") : ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t("routing.ui.noMatch")}
              </p>
            )}
          {!query && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <details className="rounded-xl border border-border/60">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-3 text-xs font-medium">
                  <WandSparkles className="size-3.5 text-muted-foreground" />
                  {t("routing.presets")}
                </summary>
                <div className="routing-presets px-2 pb-2">
                  <PresetList onAdd={onAddPreset} />
                </div>
              </details>
              <details className="rounded-xl border border-border/60">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-3 text-xs font-medium">
                  <Server className="size-3.5 text-muted-foreground" />
                  {t("routing.ui.destinations")}
                </summary>
                <div className="space-y-2 px-3 pb-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("routing.server.addHint")}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={!available.length}
                      className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-xs disabled:opacity-50"
                    >
                      <Plus className="size-3.5" />
                      {t("routing.server.add")}
                      <ChevronDown className="ml-auto size-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="max-h-72 w-64 overflow-y-auto"
                    >
                      {available.map((profile) => (
                        <DropdownMenuItem
                          key={profile.id}
                          onClick={() => onAddServer(profile.id)}
                          className="text-xs"
                        >
                          <span className="truncate">{profile.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {hiddenActions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => onShowAction(action)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-muted"
                    >
                      <Plus className="size-3.5 text-muted-foreground" />
                      {t(DESTINATIONS[action].title)}
                    </button>
                  ))}
                </div>
              </details>
              <button
                type="button"
                onClick={onAddNote}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-2.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <StickyNote className="size-3.5" />
                {t("routing.ui.addNote")}
              </button>
            </div>
          )}
        </TabsContent>
        <TabsContent
          value="priority"
          className="nowheel min-h-0 overflow-y-auto border-t border-border/60 p-3"
        >
          <p className="mb-3 px-1 text-xs leading-relaxed text-muted-foreground">
            {t("routing.ui.priorityHint")}
          </p>
          {orderPanel}
        </TabsContent>
        <TabsContent
          value="data"
          className="nowheel min-h-0 overflow-y-auto border-t border-border/60 p-3"
        >
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            {t("routing.ui.dataHint")}
          </p>
          {geoPanel}
        </TabsContent>
      </Tabs>
    </aside>
  );
}

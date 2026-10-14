import { useMemo, useState } from "react";
import { ChevronDown, Clock, MonitorSmartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useAppLabels } from "@/components/routing/app-picker";
import { useT } from "@/lib/i18n";
import { isAndroid } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AppSettings, ConfigSource, RoutingRule, SubscriptionChoice, SubscriptionInfo } from "@/types";

/** How often subscriptions refresh unless the user took a provider's interval. */
export const DEFAULT_REFRESH_HOURS = 6;

/**
 * What a subscription suggests that this device can use: an app list only
 * where apps are named by package (Android), an interval only when it is
 * not the app's own.
 */
function offerOf(info: SubscriptionInfo | undefined) {
    const hours = info?.update_hours && info.update_hours !== DEFAULT_REFRESH_HOURS ? info.update_hours : 0;
    const apps = isAndroid && info?.apps?.length && info.apps_mode ? { mode: info.apps_mode, list: info.apps } : null;
    if (!hours && !apps) return null;
    // Identifies what was offered: asked again only when it changes.
    const key = JSON.stringify({ hours, apps });
    return { hours, apps, key };
}

/**
 * A subscription's suggested settings — refreshing more often, sending some
 * apps around the tunnel — put to the user before anything changes: each
 * can be taken or not, and the answer is kept until the provider suggests
 * something different. Taking the app list adds one Applications rule to
 * routing, which stays the user's to edit or delete.
 */
export function SubscriptionSuggestions({
    sources,
    settings,
    onSave,
}: {
    sources: ConfigSource[];
    settings: AppSettings;
    onSave: (next: AppSettings) => Promise<unknown>;
}) {
    const t = useT();
    const appLabels = useAppLabels();
    // "Later" puts a subscription off until the app starts again.
    const [later, setLater] = useState<string[]>([]);
    const [takeRefresh, setTakeRefresh] = useState(true);
    const [takeApps, setTakeApps] = useState(true);
    const [showApps, setShowApps] = useState(false);
    const [busy, setBusy] = useState(false);

    const pending = useMemo(() => {
        const choices = settings.subscription_choices ?? {};
        for (const source of sources) {
            if (source.kind !== "subscription" || later.includes(source.domain)) continue;
            const offer = offerOf(source.info);
            if (offer && choices[source.domain]?.answered !== offer.key) return { source, offer };
        }
        return null;
    }, [sources, settings.subscription_choices, later]);

    if (!pending || settings === undefined) return null;
    const { source, offer } = pending;
    const choice: SubscriptionChoice = settings.subscription_choices?.[source.domain] ?? {};
    const existingRule = choice.apps_rule ? settings.routing_rules?.find((rule) => rule.id === choice.apps_rule) : undefined;

    const answer = async (accept: boolean) => {
        setBusy(true);
        const next: SubscriptionChoice = { ...choice, answered: offer.key };
        let rules = settings.routing_rules ?? [];
        if (accept && offer.hours && takeRefresh) next.refresh_hours = offer.hours;
        if (accept && offer.apps && takeApps) {
            // Bypass: these apps go direct. Proxy: every other app does.
            const rule: RoutingRule = {
                id: existingRule?.id ?? `subscription-apps-${source.domain}`,
                kind: "apps",
                values: offer.apps.list,
                action: "direct",
                invert: offer.apps.mode === "proxy",
            };
            rules = existingRule ? rules.map((item) => (item.id === rule.id ? rule : item)) : [...rules, rule];
            next.apps_rule = rule.id;
        }
        try {
            await onSave({
                ...settings,
                routing_rules: rules,
                subscription_choices: { ...(settings.subscription_choices ?? {}), [source.domain]: next },
            });
        } finally {
            setBusy(false);
            setTakeRefresh(true);
            setTakeApps(true);
            setShowApps(false);
        }
    };

    const row = (checked: boolean, onChange: (value: boolean) => void, icon: React.ReactNode, title: string, hint: string, extra?: React.ReactNode) => (
        <div className="rounded-xl border p-3">
            <label className="flex cursor-pointer items-start gap-3">
                <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
            </label>
            {extra}
        </div>
    );

    return (
        <Dialog open onOpenChange={(open) => (open ? undefined : setLater((current) => [...current, source.domain]))}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("suggest.title", { name: source.label })}</DialogTitle>
                    <DialogDescription>{t("suggest.description")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {offer.hours
                        ? row(
                              takeRefresh,
                              setTakeRefresh,
                              <Clock size={16} aria-hidden="true" />,
                              t("suggest.refresh", { count: offer.hours }),
                              t("suggest.refreshHint", { count: choice.refresh_hours || DEFAULT_REFRESH_HOURS })
                          )
                        : null}
                    {offer.apps
                        ? row(
                              takeApps,
                              setTakeApps,
                              <MonitorSmartphone size={16} aria-hidden="true" />,
                              t(offer.apps.mode === "bypass" ? "suggest.bypass" : "suggest.proxy", { count: offer.apps.list.length }),
                              t(existingRule ? "suggest.appsChanged" : "suggest.appsHint"),
                              <>
                                  <button
                                      type="button"
                                      onClick={() => setShowApps((value) => !value)}
                                      aria-expanded={showApps}
                                      className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                  >
                                      <ChevronDown size={13} className={cn("transition-transform", showApps && "rotate-180")} aria-hidden="true" />
                                      {t("suggest.showApps")}
                                  </button>
                                  {showApps ? (
                                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2 text-xs custom-scrollbar">
                                          {offer.apps.list.map((name) => (
                                              <li key={name} className="flex min-w-0 justify-between gap-3">
                                                  <span className="truncate">{appLabels.get(name) ?? name}</span>
                                                  {appLabels.has(name) ? (
                                                      <span className="truncate font-mono text-[10px] text-muted-foreground">{name}</span>
                                                  ) : null}
                                              </li>
                                          ))}
                                      </ul>
                                  ) : null}
                              </>
                          )
                        : null}
                </div>
                <DialogFooter className="gap-2 sm:justify-between">
                    <Button variant="ghost" disabled={busy} onClick={() => setLater((current) => [...current, source.domain])}>
                        {t("suggest.later")}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" disabled={busy} onClick={() => void answer(false)}>
                            {t("suggest.decline")}
                        </Button>
                        <Button disabled={busy || (!(offer.hours && takeRefresh) && !(offer.apps && takeApps))} onClick={() => void answer(true)}>
                            {t("suggest.apply")}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

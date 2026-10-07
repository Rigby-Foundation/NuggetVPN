import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardPaste,
  Code2,
  Globe,
  Layers,
  Loader2,
  QrCode,
  Split,
} from "lucide-react";

import { useAppearance } from "@/components/appearance-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NavPosition } from "@/lib/appearance";
import { LANGUAGES, LanguageChoice, MessageKey, useI18n } from "@/lib/i18n";
import { THEME_PRESETS } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { AppSettings } from "@/types";

interface WelcomeProps {
  platform: string;
  settings: AppSettings;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** How many profiles exist, so a subscription added from the dialog shows here too. */
  profileCount: number;
  onImportSubscription: (url: string) => Promise<void>;
  onSaveProfile: (name: string, link: string) => Promise<void>;
  /** The full add dialog, for QR codes and images. */
  onOpenAddDialog: () => void;
  onFinish: () => void;
}

const FEATURES = [
  { icon: Layers, title: "welcome.providers", body: "welcome.providers.body" },
  { icon: Split, title: "welcome.routing", body: "welcome.routing.body" },
  { icon: Code2, title: "welcome.open", body: "welcome.open.body" },
] as const;

/**
 * The themes offered on first start: a short, varied pick. The full set,
 * fonts and custom themes are in Settings → Appearance.
 */
const STARTER_THEMES = ["light", "paper", "frost", "dark", "slate", "stone", "cosmos", "violet", "emerald", "rose", "mocha"];

const STEPS = 4;

/** Where the navigation goes, with a wireframe of each. */
const NAV_CHOICES: { id: NavPosition; label: MessageKey }[] = [
  { id: "bottom", label: "appearance.layout.navPosition.bottom" },
  { id: "top", label: "appearance.layout.navPosition.top" },
  { id: "sidebar-left", label: "appearance.layout.navPosition.sidebarLeft" },
  { id: "sidebar-right", label: "appearance.layout.navPosition.sidebarRight" },
];

function NavWireframe({ id }: { id: NavPosition }) {
  const bar = <div className={cn("rounded-[2px] bg-primary", id === "top" || id === "bottom" ? "h-2 w-full" : "h-full w-3")} />;
  const content = <div className="flex-1 rounded-[2px] bg-muted-foreground/20" />;
  const vertical = id === "top" || id === "bottom";
  const first = id === "top" || id === "sidebar-left";
  return (
    <div className={cn("flex h-11 w-full gap-1 rounded-md border bg-muted/30 p-1", vertical ? "flex-col" : "flex-row")} aria-hidden="true">
      {first ? <>{bar}{content}</> : <>{content}{bar}</>}
    </div>
  );
}

/** A miniature of a theme: its page, a raised surface, and the accent. */
function Swatch({ background, surface, accent }: { background: string; surface: string; accent: string }) {
  return (
    <div className="relative h-14 w-full overflow-hidden rounded-lg" style={{ background }} aria-hidden="true">
      <div className="absolute inset-x-2.5 top-2.5 bottom-0 rounded-t-md" style={{ background: surface }}>
        <span className="absolute start-2 top-2 h-2 w-7 rounded-full" style={{ background: accent }} />
        <span className="absolute end-2 top-2 h-2 w-2 rounded-full opacity-70" style={{ background: accent }} />
      </div>
    </div>
  );
}

/**
 * First start: what the app is, then the look, a subscription, and the few
 * preferences worth deciding up front. Every step but the first can be
 * skipped, and everything here is also in Settings.
 */
function Welcome({
  platform,
  settings,
  theme,
  setTheme,
  onSettingChange,
  profileCount,
  onImportSubscription,
  onSaveProfile,
  onOpenAddDialog,
  onFinish,
}: WelcomeProps) {
  const { t, choice, setChoice } = useI18n();
  const { prefs, setLayout } = useAppearance();
  const [step, setStep] = useState(0);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const isPhone = platform === "android" || platform === "ios";
  const isSubscription = /^https?:\/\//i.test(link.trim());
  const added = profileCount > 0;

  const next = () => setStep((current) => Math.min(STEPS - 1, current + 1));
  const back = () => setStep((current) => Math.max(0, current - 1));

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setLink(text.trim());
    } catch {
      // Clipboard access can be refused; the field still takes a normal paste.
    }
  };

  const add = async () => {
    const value = link.trim();
    if (!value) return;
    setAdding(true);
    setAddError("");
    try {
      if (isSubscription) {
        await onImportSubscription(value);
      } else {
        const isJsonConfig = /^\s*\{/.test(value);
        await onSaveProfile(t(isJsonConfig ? "add.defaultJsonName" : "add.defaultName"), value);
      }
      setLink("");
    } catch (error) {
      setAddError(String(error));
    } finally {
      setAdding(false);
    }
  };

  const preferences: { key: keyof AppSettings; label: MessageKey; description: MessageKey; checked: boolean; hidden?: boolean }[] = [
    {
      key: "launch_at_startup",
      label: "behaviour.launch",
      description: "behaviour.launch.description",
      checked: settings.launch_at_startup,
      hidden: isPhone,
    },
    {
      key: "auto_connect",
      label: "behaviour.autoConnect",
      description: "behaviour.autoConnect.description",
      checked: settings.auto_connect,
    },
    {
      key: "auto_reconnect",
      label: "behaviour.autoReconnect",
      description: "behaviour.autoReconnect.description",
      checked: settings.auto_reconnect !== false,
    },
    {
      key: "kill_switch",
      label: "behaviour.killSwitch",
      description: "behaviour.killSwitch.description",
      checked: settings.kill_switch,
    },
  ];

  const presets = STARTER_THEMES
    .map((id) => THEME_PRESETS.find((preset) => preset.id === id))
    .filter((preset): preset is (typeof THEME_PRESETS)[number] => preset !== undefined);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* A warm wash of the accent across the top. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(ellipse_at_top,var(--primary)_0%,transparent_65%)] opacity-[0.12]"
        aria-hidden="true"
      />
      <div className="drag-region absolute inset-x-0 top-0 h-10" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-full w-full max-w-xl flex-col px-6 pt-[calc(env(safe-area-inset-top,0px)+3rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
        {/* Progress, and the language — which matters from the first word. */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5" aria-label={t("welcome.step", { step: step + 1, total: STEPS })}>
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted-foreground/25"
                )}
              />
            ))}
          </div>
          <Select value={choice} onValueChange={(value) => setChoice(value as LanguageChoice)}>
            <SelectTrigger className="h-9 w-auto gap-2 rounded-full border-border/60 bg-muted/40 px-3 text-sm" aria-label={t("settings.language")}>
              <Globe size={15} className="text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="system">{t("settings.language.followSystem")}</SelectItem>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.id} value={language.id}>
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div key={step} className="enter-stagger my-auto py-10">
          {step === 0 ? (
            <>
              {/* The wordmark reads left to right in every language. */}
              <div className="unbounded text-4xl sm:text-5xl font-semibold tracking-tight">
                <span dir="ltr" className="inline-block">
                  Nugget<span className="text-primary">.</span>
                </span>
              </div>
              <h1 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
              <p className="mt-2 text-base text-muted-foreground">{t("welcome.tagline")}</p>

              <ul className="mt-8 space-y-4">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                      <Icon size={19} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{t(title)}</span>
                      <span className="block text-sm text-muted-foreground">{t(body)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : step === 1 ? (
            <>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{t("welcome.look.title")}</h1>
              <p className="mt-2 text-base text-muted-foreground">{t("welcome.look.body")}</p>

              <div className="mt-6 grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {/* System: half light, half dark. */}
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  aria-pressed={theme === "system"}
                  className={cn(
                    "rounded-xl border p-2 text-start transition-all",
                    theme === "system" ? "border-primary ring-1 ring-primary" : "border-border/60 hover:border-border"
                  )}
                >
                  <div className="flex h-14 overflow-hidden rounded-lg" aria-hidden="true">
                    <div className="w-1/2 bg-[oklch(0.97_0_0)]" />
                    <div className="w-1/2 bg-[oklch(0.18_0.006_286)]" />
                  </div>
                  <div className="mt-1.5 truncate text-xs font-medium">{t("settings.appearance.systemTheme")}</div>
                </button>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setTheme(preset.id)}
                    aria-pressed={theme === preset.id}
                    title={t(preset.hint)}
                    className={cn(
                      "rounded-xl border p-2 text-start transition-all",
                      theme === preset.id ? "border-primary ring-1 ring-primary" : "border-border/60 hover:border-border"
                    )}
                  >
                    <Swatch {...preset.swatch} />
                    <div className="mt-1.5 truncate text-xs font-medium">{t(preset.label)}</div>
                  </button>
                ))}
              </div>

              {/* Phones keep their own navigation; this is for a window. */}
              {isPhone ? null : (
                <>
                  <h2 className="mt-7 text-sm font-semibold">{t("appearance.layout.navPosition")}</h2>
                  <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {NAV_CHOICES.map((choice) => {
                      const active = prefs.layout.navPosition === choice.id;
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => setLayout({ navPosition: choice.id })}
                          aria-pressed={active}
                          className={cn(
                            "rounded-xl border p-2 text-start transition-all",
                            active ? "border-primary ring-1 ring-primary" : "border-border/60 hover:border-border"
                          )}
                        >
                          <NavWireframe id={choice.id} />
                          <div className="mt-1.5 truncate text-xs font-medium">{t(choice.label)}</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          ) : step === 2 ? (
            <>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{t("welcome.addStep.title")}</h1>
              <p className="mt-2 text-base text-muted-foreground">{t("welcome.addStep.body")}</p>

              <div className="mt-6 space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void add();
                    }}
                    placeholder={t("add.linkPlaceholder")}
                    aria-label={t("add.linkLabel")}
                    className="h-12 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void paste()}
                    className="h-12 shrink-0 gap-2"
                  >
                    <ClipboardPaste size={16} />
                    <span className="hidden sm:inline">{t("welcome.addStep.paste")}</span>
                  </Button>
                </div>

                <Button
                  onClick={() => void add()}
                  disabled={adding || !link.trim()}
                  className="h-12 w-full text-base font-semibold"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isSubscription || !link.trim() ? (
                    t("add.importSubscription")
                  ) : (
                    t("add.addProfile")
                  )}
                </Button>

                {addError ? <p className="text-sm text-status-error break-words">{addError}</p> : null}

                {added ? (
                  <div className="flex items-center gap-2.5 rounded-xl bg-primary/10 px-4 py-3 text-sm font-medium">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check size={14} />
                    </span>
                    {t("welcome.addStep.done", { count: profileCount })}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={onOpenAddDialog}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <QrCode size={15} />
                  {t("welcome.addStep.more")}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{t("welcome.prefs.title")}</h1>
              <p className="mt-2 text-base text-muted-foreground">{t("welcome.prefs.body")}</p>

              <div className="mt-6 divide-y divide-border/60 overflow-hidden rounded-2xl bg-muted/40">
                {preferences
                  .filter((preference) => !preference.hidden)
                  .map((preference) => (
                    <label
                      key={preference.key}
                      className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(preference.label)}</span>
                        <span className="block text-xs text-muted-foreground">{t(preference.description)}</span>
                      </span>
                      <Switch
                        checked={preference.checked}
                        onCheckedChange={(checked) => onSettingChange(preference.key, checked as never)}
                      />
                    </label>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={back} className="h-12 gap-2 px-4 text-muted-foreground">
              <ArrowLeft size={17} className="rtl:-scale-x-100" />
              {t("common.back")}
            </Button>
          ) : null}
          <div className="flex-1" />
          {/* Until something is added, moving on means skipping the step. */}
          {step === 2 && !added ? (
            <Button variant="outline" onClick={next} className="h-12 min-w-36 gap-2 text-base">
              {t("welcome.later")}
              <ArrowRight size={17} className="rtl:-scale-x-100" />
            </Button>
          ) : step < STEPS - 1 ? (
            <Button onClick={next} className="h-12 min-w-36 gap-2 text-base font-semibold">
              {step === 0 ? t("welcome.start") : t("common.continue")}
              <ArrowRight size={17} className="rtl:-scale-x-100" />
            </Button>
          ) : (
            <Button onClick={onFinish} className="h-12 min-w-36 gap-2 text-base font-semibold">
              {t("welcome.finish")}
              <Check size={17} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Welcome;

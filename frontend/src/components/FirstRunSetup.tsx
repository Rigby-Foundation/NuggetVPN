import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Upload } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useVpn } from "@/app/vpn-context";
import { defaultPage } from "@/app/pages";
import AddModal from "@/components/AddModal";
import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { restoreWindowState } from "@/components/settings/backup";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorMessage, invoke } from "@/lib/backend";
import { LANGUAGES, useI18n, type LanguageChoice } from "@/lib/i18n";
import { selectTheme, useThemeState } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/types";

const stages = ["appearance", "privacy", "configuration"] as const;

export function FirstRunSetup() {
  const { t, choice, setChoice, dir } = useI18n();
  const vpn = useVpn();
  const navigate = useNavigate();
  const theme = useThemeState();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const reducedMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [add, setAdd] = useState(false);
  const [ipCheck, setIPCheck] = useState(vpn.settings.ip_check_enabled ?? true);
  const [analytics, setAnalytics] = useState(vpn.settings.app_stats ?? true);
  const [logging, setLogging] = useState(vpn.settings.logging_enabled ?? false);
  const stage = stages[step];
  const languages = { system: t("settings.language.followSystem"), ...Object.fromEntries(LANGUAGES.map(({ id, label }) => [id, label])) };
  const offset = reducedMotion ? 0 : 16 * direction * (dir === "rtl" ? -1 : 1);
  const goToStep = (next: number) => {
    if (next === step) return;
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError("");
  };

  const save = async (complete = false) => {
    setBusy(true);
    setError("");
    try {
      // Save through the provider's queue, including any profile selection
      // written after an import completed.
      await vpn.saveSettings({
        ...vpn.settings,
        ip_check_enabled: ipCheck,
        app_stats: analytics,
        logging_enabled: logging,
        setup_completed: complete,
      }, false);
      if (complete) navigate(defaultPage, { replace: true });
      else goToStep(step + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await invoke<{
        imported: boolean; settings: AppSettings; ui?: Record<string, string>;
      }>("import_backup");
      if (!result.imported) return;
      await vpn.saveSettings({ ...result.settings, setup_completed: true }, false);
      restoreWindowState(result.ui);
      window.location.reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const onContinue = () => {
    if (step === 0) goToStep(1);
    else void save(step === 2);
  };

  return (
    <section className="@container mx-auto grid min-h-full w-full max-w-5xl content-center gap-7 p-5 sm:p-9" aria-labelledby="setup-title">
      <div className="grid min-w-0 gap-7 @min-[680px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)] @min-[680px]:gap-14">
        <motion.header
          initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0.12 : 0.3, ease: "easeOut" }}
          className="space-y-5 @min-[680px]:pt-2"
        >
          <div className="space-y-2">
            <h1 id="setup-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("setup.title")}</h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t("setup.description")}</p>
          </div>
          <nav aria-label={t("setup.steps")}>
            <ol className="flex flex-wrap gap-x-5 gap-y-3 @min-[680px]:flex-col">
              {stages.map((name, index) => (
                <li key={name}>
                  <button
                    type="button"
                    disabled={busy || index > step}
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => goToStep(index)}
                    className={cn(
                      "flex min-h-9 items-center gap-2 text-sm outline-none transition-colors focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      index === step ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    <span className={cn("relative grid size-5 place-items-center rounded-full border text-xs tabular-nums transition-colors duration-200 motion-reduce:transition-none", index === step && "border-foreground/50 bg-muted text-foreground")}>
                      <AnimatePresence initial={false} mode="wait">
                        <motion.span
                          key={index < step ? "complete" : "number"}
                          initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.8 }}
                          transition={{ duration: 0.12 }}
                          className="grid place-items-center"
                        >
                          {index < step ? <Check size={12} aria-hidden="true" /> : index + 1}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                    {t(`setup.${name}`)}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </motion.header>
        <div className="min-w-0 space-y-5">
          <AnimatePresence mode="wait" custom={offset}>
            <motion.div
              key={stage}
              custom={offset}
              variants={{
                enter: (x: number) => ({ opacity: 0, x }),
                visible: { opacity: 1, x: 0, transition: { duration: reducedMotion ? 0.12 : 0.24, ease: [0.2, 0.65, 0.35, 1] } },
                leave: (x: number) => ({ opacity: 0, x: -x * 0.5, transition: { duration: 0.12 } }),
              }}
              initial="enter"
              animate="visible"
              exit="leave"
              className="space-y-4"
            >
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{t(`setup.${stage}`)}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(`setup.${stage}.description`)}</p>
              </div>
              {step === 0 && (
                <SettingsGroup>
                  <SettingsField
                    stacked
                    label={t("settings.language")}
                    control={(
                      <Select<LanguageChoice>
                        value={choice}
                        items={languages}
                        onValueChange={(value) => { if (value) setChoice(value); }}
                      >
                        <SelectTrigger aria-label={t("settings.language")} className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">{languages.system}</SelectItem>
                          {LANGUAGES.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <SettingsField
                    stacked
                    label={t("appearance.theme")}
                    control={(
                      <div className="flex flex-wrap gap-2">
                        {(["system", "dark", "light"] as const).map((id) => (
                          <Button
                            key={id}
                            variant="outline"
                            aria-pressed={theme.selected === id}
                            onClick={() => selectTheme(id)}
                            className={cn("relative min-h-10 flex-1 transition-[color,background-color,border-color,transform] duration-200 motion-safe:active:scale-[0.97] motion-reduce:transition-none", theme.selected === id && "border-ring bg-accent")}
                          >
                            {theme.selected === id && (
                              <motion.span
                                layoutId="setup-theme-selection"
                                className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-ring"
                                transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
                              />
                            )}
                            <span className="relative">{t(id === "system" ? "settings.appearance.systemTheme" : `theme.${id}`)}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  />
                </SettingsGroup>
              )}
              {step === 1 && (
                <SettingsGroup>
                  <SettingsField label={t("privacy.ipCheck")} description={t("privacy.ipCheck.description")} control={<Switch checked={ipCheck} onCheckedChange={setIPCheck} aria-label={t("privacy.ipCheck")} />} />
                  <SettingsField label={t("privacy.appStats")} description={t("privacy.appStats.description")} control={<Switch checked={analytics} onCheckedChange={setAnalytics} aria-label={t("privacy.appStats")} />} />
                  <SettingsField label={t("privacy.logs")} description={t("privacy.logs.description")} control={<Switch checked={logging} onCheckedChange={setLogging} aria-label={t("privacy.logs")} />} />
                </SettingsGroup>
              )}
              {step === 2 && (
                <SettingsGroup>
                  {vpn.profiles.length > 0 ? (
                    <p role="status" className="flex items-center gap-2 text-sm"><Check size={17} aria-hidden="true" />{t("sources.proxies", { count: vpn.profiles.length })}</p>
                  ) : (
                    <div className="grid gap-2">
                      <Button variant="outline" className="h-auto justify-start px-3 py-3 text-start" disabled={busy} onClick={() => setAdd(true)}>
                        <Plus aria-hidden="true" /><span className="whitespace-normal">{t("setup.add")}</span>
                      </Button>
                      <Button variant="outline" className="h-auto justify-start px-3 py-3 text-start" disabled={busy} onClick={() => void restoreBackup()}>
                        <Upload aria-hidden="true" /><span className="whitespace-normal">{t("setup.restore")}</span>
                      </Button>
                    </div>
                  )}
                </SettingsGroup>
              )}
            </motion.div>
          </AnimatePresence>
          {error && <p className="text-sm leading-relaxed text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            {step > 0 ? <Button variant="ghost" disabled={busy} onClick={() => goToStep(step - 1)}><ArrowLeft className="rtl:rotate-180" aria-hidden="true" />{t("setup.back")}</Button> : <span />}
            <Button disabled={busy} onClick={onContinue}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t(step === 2 ? vpn.profiles.length ? "setup.finish" : "setup.later" : "setup.next")}
              {!busy && <ArrowRight className="rtl:rotate-180" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
      <AddModal
        isOpen={add}
        onClose={() => setAdd(false)}
        onSaveProfile={async (name, link) => { await vpn.addProfile(name, link); }}
        onImportSubscription={async (url) => { await vpn.importSubscription(url); }}
      />
    </section>
  );
}

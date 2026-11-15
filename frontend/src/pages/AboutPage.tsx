import { useEffect, useState, type ComponentProps } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Heart, Info, RefreshCw, Scale } from "lucide-react";
import { Link } from "react-router";
import { settingsPage } from "@/app/pages";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { errorMessage, invoke, openExternal } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { hasNativeRuntime } from "@/lib/platform";
import wordmark from "@/public/kage.svg";
import type { UpdateInfo } from "@/types";
import { version as bundledVersion } from "../../package.json";

const project = {
  name: "Kage",
  license: "MPL-2.0",
  licenseURL: "https://github.com/Rigby-Foundation/NuggetVPN/blob/main/LICENSE",
};

const credits = [
  { name: "Wails", url: "https://wails.io/", license: "MIT", licenseURL: "https://github.com/wailsapp/wails/blob/v3.0.0/LICENSE" },
  { name: "Xray", url: "https://github.com/XTLS/Xray-core", license: "MPL-2.0", licenseURL: "https://github.com/XTLS/Xray-core/blob/main/LICENSE" },
  { name: "React", url: "https://react.dev/", license: "MIT", licenseURL: "https://github.com/facebook/react/blob/main/LICENSE" },
];

function ProjectLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (hasNativeRuntime()) {
          event.preventDefault();
          openExternal(href);
        }
      }}
    />
  );
}

export default function AboutPage() {
  const t = useT();
  const [version, setVersion] = useState(bundledVersion);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    invoke<string>("get_version").then((value) => {
      if (active && value) setVersion(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    setUpdate(null);
    setError("");
    try {
      setUpdate(await invoke<UpdateInfo>("check_for_update"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="grid min-h-full grid-rows-[auto_1fr_auto]" aria-labelledby="about-title">
      <header className="flex min-h-14 items-center gap-2.5 border-b border-border/60 px-3 sm:px-5">
        <Link
          to={settingsPage}
          replace
          aria-label={t("common.back")}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h1 id="about-title" className="text-base font-semibold">{t("settings.about")}</h1>
      </header>

      <div className="grid min-h-72 place-items-center px-5 py-10 text-center">
        <div data-page-part="0" className="flex min-w-0 max-w-full flex-col items-center">
          <img
            src={wordmark}
            alt="Kage"
            width={141}
            height={32}
            draggable={false}
            className="h-auto w-52 max-w-full select-none invert sm:w-60 dark:invert-0"
          />
          <p className="mt-4 text-base font-medium text-muted-foreground">
            {t("updates.version")} <bdi className="font-semibold tabular-nums text-primary">{version}</bdi>
          </p>
          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-xs text-muted-foreground">
            {__KAGE_REVISION__ && (
              <>
                <span>{t("about.build")} <bdi className="font-mono">{__KAGE_REVISION__}</bdi></span>
                <span aria-hidden="true" className="text-border">·</span>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void checkForUpdates()}
              disabled={checking}
              className="px-1.5 text-xs text-muted-foreground"
            >
              <RefreshCw className={checking ? "size-3 motion-safe:animate-spin" : "size-3"} aria-hidden="true" />
              {checking ? t("updates.checking") : t("about.checkUpdates")}
            </Button>
          </div>
          <div aria-live="polite" className="max-w-sm text-xs text-muted-foreground">
            {error ? (
              <p className="break-words text-destructive">{error}</p>
            ) : update ? (
              update.available ? (
                <p>
                  {t("updates.available", { version: update.latest })}{" "}
                  {update.page_url && (
                    <ProjectLink href={update.page_url} className="underline underline-offset-3 hover:text-foreground">
                      {t("updates.page")}
                    </ProjectLink>
                  )}
                </p>
              ) : t("about.upToDate")
            ) : null}
          </div>

          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" className="mt-4 rounded-full px-3 text-muted-foreground" />}>
              <Scale className="size-3.5" aria-hidden="true" />
              {t("about.licenses")}
              <ChevronRight className="size-3 opacity-70 rtl:rotate-180" aria-hidden="true" />
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
              <DialogHeader className="pe-8">
                <DialogTitle>{t("about.licenses")}</DialogTitle>
                <DialogDescription>{t("about.licenses.description")}</DialogDescription>
              </DialogHeader>
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {[project, ...credits].map(({ name, license, licenseURL }) => (
                  <li key={name}>
                    <ProjectLink href={licenseURL} className="flex min-h-10 items-center gap-2 px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                      <span className="flex-1 font-medium">{name}</span>
                      <bdi className="text-xs text-muted-foreground">{license}</bdi>
                      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    </ProjectLink>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <footer className="space-y-1 px-5 pb-5 text-center text-xs text-muted-foreground" data-page-part="1">
        <p className="flex flex-wrap items-center justify-center gap-x-1.5">
          <span>{t("about.builtWith")}</span>
          {credits.map(({ name, url }, index) => (
            <span key={name} className="inline-flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">·</span>}
              <ProjectLink href={url} className="underline decoration-border underline-offset-3 hover:text-foreground">{name}</ProjectLink>
            </span>
          ))}
        </p>
        <p className="flex flex-wrap items-center justify-center gap-1">
          <Heart className="size-3 text-rose-500" aria-hidden="true" />
          <span>{t("about.specialThanks")}</span>
          <ProjectLink
            href="https://acelate.com/beam"
            className="underline decoration-border underline-offset-3 hover:text-foreground"
          >
            {t("about.specialThanksProject")}
          </ProjectLink>
          <span>{t("about.specialThanksReason")}</span>
        </p>
        <p>© 2026 Rigby Foundation</p>
      </footer>
    </section>
  );
}

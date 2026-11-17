import { useEffect, useState, type ComponentProps } from "react";
import { ChevronRight, ExternalLink, Heart, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { invoke, openExternal } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { hasNativeRuntime } from "@/lib/platform";
import wordmark from "@/public/kage.svg";
import { version as bundledVersion } from "../../package.json";

const project = {
  name: "Kage",
  license: "MPL-2.0",
  licenseURL: "https://github.com/Rigby-Foundation/Kage/blob/main/LICENSE",
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

  useEffect(() => {
    let active = true;
    invoke<string>("get_version").then((value) => {
      if (active && value) setVersion(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <section className="grid min-h-full grid-rows-[1fr_auto]" aria-labelledby="about-title">
      <div className="grid min-h-72 place-items-center px-5 py-10 text-center">
        <div data-page-part="0" className="flex min-w-0 max-w-full flex-col items-center">
          <h1 id="about-title" className="sr-only">{t("settings.about")}</h1>
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
          {__KAGE_REVISION__ && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("about.build")} <bdi className="font-mono">{__KAGE_REVISION__}</bdi>
            </p>
          )}

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

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { SettingsGroup } from "@/components/settings/shell";
import { Button } from "@/components/ui/button";
import { parseAnsi, stripAnsi } from "@/lib/ansi";
import { EVENTS, errorMessage, invoke, listen } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { hasNativeRuntime } from "@/lib/platform";

const LogLine = memo(function LogLine({ line }: { line: string }) {
  const plain = stripAnsi(line);
  const tone = /^\[?(ERROR|FATAL|PANIC)\b/i.test(plain)
    ? "text-destructive"
    : /^\[?WARN(?:ING)?\b/i.test(plain)
      ? "text-amber-700 dark:text-amber-400"
      : undefined;

  return (
    <li className={tone}>
      {parseAnsi(line).map((segment, index) => (
        <span key={index} style={{ color: segment.color }} className={segment.bold ? "font-semibold" : undefined}>
          {segment.text}
        </span>
      ))}
    </li>
  );
});

export function LogsPanel({ enabled, onEnable }: { enabled: boolean; onEnable: () => void }) {
  const t = useT();
  if (!enabled) {
    return (
      <SettingsGroup title={t("logs.off")} description={t("logs.off.description")}>
        <Button onClick={onEnable}>{t("logs.off.enable")}</Button>
      </SettingsGroup>
    );
  }
  return <LogViewer />;
}

function LogViewer() {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const native = hasNativeRuntime();

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let reading = false;
    let pending = false;
    let timer: number | undefined;

    const refresh = async () => {
      pending = false;
      reading = true;
      try {
        const snapshot = await invoke<{ lines: string[] | null }>("get_logs");
        if (!disposed) {
          setLines(snapshot.lines ?? []);
          setError("");
        }
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause));
      } finally {
        reading = false;
        if (!disposed) {
          setLoading(false);
          if (pending) schedule();
        }
      }
    };

    // Wails can emit several log batches in a single burst. Coalesce them
    // and only apply one snapshot at a time, including the initial read.
    const schedule = () => {
      pending = true;
      if (reading || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 100);
    };

    const unlisten = listen(EVENTS.log, schedule);
    void refresh();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten();
    };
  }, [native]);

  useLayoutEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [lines]);

  const exportLogs = async () => {
    setExporting(true);
    try {
      const path = await invoke<string>("export_logs");
      if (path) toast.success(t("logs.saved"));
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-muted-foreground">{t("logs.lines", { count: lines.length })}</p>
        <Button variant="outline" disabled={exporting || !lines.length} onClick={() => void exportLogs()}>
          {exporting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          {t("logs.export")}
        </Button>
      </div>
      <div
        ref={viewport}
        role="region"
        tabIndex={0}
        aria-label={t("settings.logs")}
        aria-busy={native && loading}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          follow.current = scrollHeight - scrollTop - clientHeight < 24;
        }}
        className="h-[clamp(12rem,50vh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-background/70 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {error ? (
          <p role="alert" className="text-xs text-destructive">{error}</p>
        ) : !native ? (
          <p className="text-xs text-muted-foreground">{t("ui.nativeAction")}</p>
        ) : loading ? (
          <Loader2 className="size-4 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
        ) : !lines.length ? (
          <p className="text-xs text-muted-foreground">{t("logs.empty")}</p>
        ) : (
          <ol dir="ltr" className="space-y-0.5 whitespace-pre-wrap wrap-anywhere font-mono text-xs leading-relaxed text-muted-foreground [--log-l:34%] dark:[--log-l:72%]">
            {lines.map((line, index) => <LogLine key={index} line={line} />)}
          </ol>
        )}
      </div>
    </SettingsGroup>
  );
}

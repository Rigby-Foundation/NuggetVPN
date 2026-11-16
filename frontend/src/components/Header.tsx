import { Minus, MoveDiagonal, Square, X } from "lucide-react";
import { getPlatform } from "@/lib/platform";
import { windowAction } from "@/lib/window";
import Kage from "@/public/kage.svg";
import { useT } from "@/lib/i18n";

export function AppHeader() {
  const platform = getPlatform();
  const t = useT();
  const isMac = platform === "macos";
  const desktop = isMac || platform === "windows" || platform === "linux";

  return (
    <header
      data-platform={platform}
      className={`app-header relative z-20 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-sidebar text-sidebar-foreground compact:h-11 ${desktop ? "window-drag" : ""}`}
      onDoubleClick={(event) => {
        if (desktop && !(event.target as HTMLElement).closest("button")) {
          void windowAction("ToggleMaximiseWindow");
        }
      }}
    >
      <div className="flex items-center gap-3 pl-4">
        {isMac && (
          <div
            aria-label={t("ui.windowControls")}
            className="group flex items-center gap-2"
          >
            {(
              [
                {
                  label: t("ui.windowClose"),
                  action: "RequestClose",
                  color: "bg-[#ff5f57]",
                  Icon: X,
                },
                {
                  label: t("ui.windowMinimize"),
                  action: "MinimiseWindow",
                  color: "bg-[#febc2e]",
                  Icon: Minus,
                },
                {
                  label: t("ui.windowMaximize"),
                  action: "ToggleMaximiseWindow",
                  color: "bg-[#28c840]",
                  Icon: MoveDiagonal,
                },
              ] as const
            ).map(({ label, action, color, Icon }) => (
              <button
                key={action}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => void windowAction(action)}
                className={`flex size-3 items-center justify-center rounded-full text-black/65 ring-black/10 ring-inset focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${color}`}
              >
                <Icon
                  className="size-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  strokeWidth={2.5}
                />
              </button>
            ))}
          </div>
        )}
      </div>
      <img
        src={Kage}
        alt="Kage"
        width={141}
        height={32}
        draggable={false}
        className="pointer-events-none block h-7 w-auto translate-y-[12.5%] select-none invert compact:h-5 dark:invert-0"
      />
      <div className="flex h-full items-center justify-end">
        {(platform === "windows" || platform === "linux") && (
          <div
            aria-label={t("ui.windowControls")}
            className="flex h-full items-center"
          >
            <button
              type="button"
              aria-label={t("ui.windowMinimize")}
              title={t("ui.windowMinimize")}
              onClick={() => void windowAction("MinimiseWindow")}
              className="window-button"
            >
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t("ui.windowMaximize")}
              title={t("ui.windowMaximize")}
              onClick={() => void windowAction("ToggleMaximiseWindow")}
              className="window-button"
            >
              <Square className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("ui.windowClose")}
              title={t("ui.windowClose")}
              onClick={() => void windowAction("RequestClose")}
              className="window-button hover:bg-red-500 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

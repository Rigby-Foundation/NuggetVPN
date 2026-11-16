import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

import { useNavigate } from "react-router";
import { useVpn } from "@/app/vpn-context";
import { Page } from "@/components/Page";
import { ImportProfilesButton, SourcePicker } from "@/components/SourcePicker";
import { Flag } from "@/components/ui/flag";
import { useTraffic } from "@/hooks/use-traffic";
import { useIsMobile } from "@/hooks/use-mobile";
import { LOCAL, profileDomain } from "@/hooks/use-profiles";
import { errorMessage } from "@/lib/backend";
import { withoutFlagEmoji } from "@/lib/flags";
import { formatBytes, formatDuration } from "@/lib/format";
import { hasNativeRuntime } from "@/lib/platform";
import { groupProfiles } from "@/lib/server-selection";
import {
  Activity,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Ghost,
  LayoutGrid,
  Loader2,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const streaks = [
  { angle: -155, distance: 65, length: 23, delay: 0 },
  { angle: -112, distance: 95, length: 16, delay: 0.04 },
  { angle: -72, distance: 55, length: 29, delay: 0.08 },
  { angle: -24, distance: 85, length: 19, delay: 0.02 },
  { angle: 19, distance: 110, length: 25, delay: 0.1 },
  { angle: 67, distance: 70, length: 14, delay: 0.06 },
  { angle: 118, distance: 100, length: 22, delay: 0.12 },
  { angle: 164, distance: 60, length: 18, delay: 0.03 },
];

export default function ConnectionPage() {
  const vpn = useVpn();
  const t = useT();
  const {
    connection,
    connectionPending,
    selection,
    domainProfiles,
    probeProfiles,
  } = vpn;
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const compact = useIsMobile();
  const [burst, setBurst] = useState(0);
  const [serverOpen, setServerOpen] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [now, setNow] = useState(Date.now);
  const connected = connection.status === "connected";
  const connecting =
    !connected &&
    (connectionPending === "connect" || connection.status === "connecting");
  const busy = connecting || !!connectionPending;
  const locked = connecting || !!connectionPending;
  const native = hasNativeRuntime();

  const actual =
    connected || connection.status === "connecting"
      ? vpn.profiles.find((profile) => profile.id === connection.profile_id)
      : undefined;
  const selected = domainProfiles.find(
    (profile) => profile.id === selection.profileId,
  );
  const serverName =
    actual?.name ||
    (connected || connecting ? connection.profile : undefined) ||
    (selection.mode === "auto"
      ? t("proxies.auto")
      : selected?.name || t("ui.chooseServer"));
  const canConnect =
    selection.mode === "auto" ? domainProfiles.length > 0 : !!selected;
  const groups = groupProfiles(domainProfiles);
  const since = connected ? connection.since : undefined;
  const traffic = useTraffic(
    connected ? `${connection.profile_id ?? ""}:${since ?? ""}` : null,
  );
  const activeId = connected ? actual?.id : undefined;
  const activeDomain = actual ? profileDomain(actual) : undefined;

  useEffect(() => {
    if (!since) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  useEffect(() => {
    if (activeId && activeDomain)
      void probeProfiles(activeDomain, [activeId]).catch(() => undefined);
  }, [activeId, activeDomain, since, probeProfiles]);

  const ping = activeId ? vpn.profilePings[activeId] : undefined;
  const stats = [
    {
      label: t("connection.latency"),
      value: ping == null ? "—" : t("proxies.ms", { ms: ping }),
      icon: Activity,
      color: "text-foreground",
    },
    {
      label: t("connection.duration"),
      value: since ? formatDuration(now - since) : "—",
      icon: Clock3,
      color: "text-foreground",
    },
    {
      label: t("connection.download"),
      value: traffic ? formatBytes(traffic.down) : "—",
      icon: Download,
      color: "text-status-connected",
    },
    {
      label: t("connection.upload"),
      value: traffic ? formatBytes(traffic.up) : "—",
      icon: Upload,
      color: "text-blue-400",
    },
  ];

  const status =
    connectionPending === "switch"
      ? t("connection.switching")
      : connectionPending === "reload"
        ? t("connection.reloading")
        : connectionPending === "disconnect"
          ? t("ui.disconnecting")
          : connecting
            ? connection.reconnecting
              ? t("ui.reconnecting")
              : t("status.connecting")
            : connected
              ? t("status.connected")
              : connection.blocked
                ? t("connection.blocked")
                : !vpn.loaded
                  ? vpn.error
                    ? t("status.error")
                    : t("ui.loadingProfiles")
                  : !native
                    ? t("ui.openApp")
                    : !canConnect
                      ? t("ui.chooseProfile")
                      : connection.status === "error"
                        ? t("ui.retry")
                        : t("connection.connect");
  const actionLabel =
    connected || connection.status === "connecting" || connection.blocked
      ? t("connection.disconnect")
      : t("connection.connect");
  const message = vpn.error || connection.error || requestError;
  const handleClick = async () => {
    setRequestError("");
    if (!reducedMotion) setBurst((previous) => previous + 1);
    try {
      await vpn.toggleConnection();
    } catch (cause) {
      setRequestError(errorMessage(cause));
    }
  };

  return (
    <Page title={t("ui.connectionPage")} className="h-full compact:h-auto compact:min-h-full compact:p-3" hideTitle>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-1 pt-1 sm:px-4 sm:pt-3 compact:grid compact:grid-cols-1 compact:gap-2 compact:px-0 compact:pt-0">
          <div
            data-page-part="0"
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <SourcePicker
              disabled={locked || !vpn.loaded}
              displayDomain={activeDomain}
            />
            <ImportProfilesButton
              compact
              disabled={locked || !vpn.loaded || !native}
            />
          </div>

          <Popover open={serverOpen} onOpenChange={setServerOpen}>
            <PopoverTrigger
              data-page-part="1"
              disabled={locked || !vpn.loaded}
              aria-label={t("serverPicker.label", { name: serverName })}
              className="flex h-10 min-w-0 max-w-full items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 transition-colors enabled:hover:bg-accent/50 sm:max-w-[52%] compact:h-11 compact:max-w-full"
            >
              <Flag
                name={
                  actual?.name ||
                  (connected || connecting
                    ? connection.profile
                    : selected?.name)
                }
                auto={
                  !actual && !connection.profile && selection.mode === "auto"
                }
                size={23}
              />
              <span className="truncate text-sm font-medium">
                {withoutFlagEmoji(serverName) || serverName}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground compact:ms-auto" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-1.5"
            >
              <div className="max-h-[min(360px,58vh)] overflow-y-auto">
                {selection.domain !== LOCAL && domainProfiles.length > 0 && (
                  <ServerOption
                    name={t("proxies.auto")}
                    detail={t("proxies.autoHint")}
                    auto
                    selected={selection.mode === "auto"}
                    onSelect={() => {
                      vpn.setSelection({
                        ...selection,
                        mode: "auto",
                        profileId: "",
                      });
                      setServerOpen(false);
                    }}
                  />
                )}
                {groups.map(({ name, profiles }) => (
                  <div key={name ?? ""} className="py-1">
                    {name && (
                      <p className="truncate px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                        {name}
                      </p>
                    )}
                    {profiles.map((profile) => (
                      <ServerOption
                        key={profile.id}
                        name={profile.name}
                        detail={
                          vpn.unsupportedProfiles[profile.id] || profile.description || profile.protocol.toUpperCase()
                        }
                        disabled={!!vpn.unsupportedProfiles[profile.id]}
                        selected={
                          selection.mode === "manual" &&
                          profile.id === selected?.id
                        }
                        onSelect={() => {
                          vpn.setSelection({
                            domain: selection.domain,
                            mode: "manual",
                            profileId: profile.id,
                          });
                          setServerOpen(false);
                        }}
                      />
                    ))}
                  </div>
                ))}
                {!domainProfiles.length && (
                  <p className="px-2.5 py-3 text-xs text-muted-foreground">
                    {t("ui.serverListEmpty")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setServerOpen(false);
                  navigate("/profiles");
                }}
                className="flex items-center gap-2.5 rounded-lg border-t border-border/60 px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground compact:min-h-11"
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
                {t("serverPicker.all")}
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Main connection area */}
        <div className="relative flex-1 min-h-0 flex items-center justify-center compact:min-h-56 compact:flex-col compact:gap-3 compact:pt-4">
          {/* Energy burst */}
          <AnimatePresence>
            {burst > 0 && (
              <motion.div
                key={burst}
                className="absolute inset-[-160px] pointer-events-none z-20"
              >
                <motion.div
                  className="absolute left-1/2 top-1/2 size-40 rounded-full bg-primary/30 blur-3xl"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{
                    scale: 2,
                    opacity: [0, 0.8, 0],
                  }}
                  transition={{
                    duration: 0.7,
                    ease: "easeOut",
                  }}
                  style={{
                    x: "-50%",
                    y: "-50%",
                  }}
                />

                {streaks.map((streak, i) => {
                  const angle = (streak.angle * Math.PI) / 180;
                  const start = 140;

                  return (
                    <motion.span
                      key={i}
                      className="absolute left-1/2 top-1/2 h-[2px] rounded-full bg-primary origin-left"
                      style={{
                        width: streak.length,
                        boxShadow: "0 0 8px var(--primary)",
                      }}
                      initial={{
                        x: Math.cos(angle) * start,
                        y: Math.sin(angle) * start,
                        rotate: streak.angle,
                        opacity: 0,
                        scaleX: 0.2,
                      }}
                      animate={{
                        x: Math.cos(angle) * (start + streak.distance),
                        y: Math.sin(angle) * (start + streak.distance),
                        opacity: [0, 1, 0],
                        scaleX: [0.2, 1, 0.1],
                      }}
                      transition={{
                        duration: 0.45 + (i % 3) * 0.12,
                        delay: streak.delay,
                        ease: "easeOut",
                      }}
                    />
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* The entry transition and connection-state movement use separate elements. */}
          <div data-page-part="2" className="min-w-0 max-w-full">
            <motion.div
              animate={{
                y: connected ? (compact ? -8 : -60) : 0,
              }}
              transition={{
                duration: reducedMotion ? 0 : 0.45,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="flex flex-col gap-2 items-center"
            >
              <button
                type="button"
                onClick={() => void handleClick()}
                aria-label={actionLabel}
                aria-busy={busy}
                disabled={
                  !!connectionPending ||
                  !vpn.loaded ||
                  !native ||
                  (!connected &&
                    !connecting &&
                    !connection.blocked &&
                    !canConnect)
                }
                className={`group relative z-10 grid size-[clamp(9rem,35vmin,17.5rem)] place-items-center rounded-full border border-border transition-[background-color,border-color,opacity,scale] duration-300 enabled:cursor-pointer motion-safe:enabled:hover:scale-[1.04] motion-safe:enabled:active:scale-[0.98] disabled:opacity-70 ${
                  connected ? "bg-primary" : "bg-muted"
                }`}
              >
                <Loader2
                  className={`col-start-1 row-start-1 size-12 transition-[color,opacity] duration-200 ${
                    busy ? "opacity-100 motion-safe:animate-spin" : "opacity-0"
                  } ${connected ? "text-primary-foreground" : "text-primary"}`}
                  aria-hidden="true"
                />
                <Ghost
                  className={`col-start-1 row-start-1 size-[47%] transition-[color,opacity,scale] duration-300 ${
                    busy ? "opacity-0 motion-safe:scale-90" : "opacity-100"
                  } ${
                    connected
                      ? "text-primary-foreground"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                  aria-hidden="true"
                />
              </button>

              <p role="status" className="text-center text-sm text-muted-foreground">
                {status}
              </p>
              {message && !connected && !connecting && (
                <p
                  role="alert"
                  className="max-h-24 max-w-xs overflow-auto break-words text-center text-xs text-status-error"
                >
                  {message}
                  {!vpn.loaded && (
                    <button
                      type="button"
                      onClick={() => void vpn.reload()}
                      className="ms-2 underline"
                    >
                      {t("ui.retry")}
                    </button>
                  )}
                </p>
              )}
            </motion.div>
          </div>

          {/* Connection statistics */}
          <AnimatePresence>
            {connected && (
              <motion.div
                initial={{
                  opacity: 0,
                  y: 8,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                  y: 8,
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.2,
                  ease: "easeOut",
                }}
                className="absolute top-[calc(50%+clamp(58px,14vmin,105px))] left-1/2 w-full max-w-2xl -translate-x-1/2 px-1 compact:static compact:translate-x-0 compact:px-0"
              >
                <div className="grid grid-cols-2 gap-y-3 rounded-xl border border-border/60 bg-background/80 px-2 py-3 sm:grid-cols-4">
                  {stats.map((stat, i) => {
                    const Icon = stat.icon;

                    return (
                      <div
                        key={stat.label}
                        data-page-part={Math.min(i + 3, 6)}
                        className={`flex-1 min-w-0 px-3 flex flex-col gap-1.5 ${i % 2 === 0 ? "border-e border-border" : i === 1 ? "sm:border-e sm:border-border" : ""}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon className="size-3.5 text-muted-foreground" />

                          <span className="text-xs text-muted-foreground">
                            {stat.label}
                          </span>
                        </div>

                        <div className={`text-xl tabular-nums ${stat.color}`}>
                          {stat.value}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Page>
  );
}

function ServerOption({
  name,
  detail,
  auto,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  detail: string;
  auto?: boolean;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={disabled ? detail : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors disabled:opacity-50 compact:min-h-11 ${selected ? "bg-accent" : "enabled:hover:bg-accent/60"}`}
    >
      <Flag name={name} auto={auto} size={25} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {withoutFlagEmoji(name) || name}
        </span>
        <span
          className="block truncate text-[11px] text-muted-foreground"
          title={detail}
        >
          {detail}
        </span>
      </span>
      {selected && (
        <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      )}
    </button>
  );
}

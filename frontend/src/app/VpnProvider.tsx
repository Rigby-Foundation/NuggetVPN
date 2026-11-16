import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import toast from "react-hot-toast";
import {
  useProfiles,
  reconcileSelection,
  type Selection,
} from "@/hooks/use-profiles";
import {
  EVENTS,
  eventPayload,
  errorMessage,
  invoke,
  listen,
} from "@/lib/backend";
import { hasNativeRuntime } from "@/lib/platform";
import type {
  AppSettings,
  ConnectionState,
  PluginInfo,
  ProfileEncryptionStatus,
  ProfilePing,
} from "@/types";

import { CoreReloadDialog } from "@/components/CoreReloadDialog";
import { pendingSettings } from "@/app/default-settings";
import { currentLanguage, translate } from "@/lib/i18n";
import { VpnContext } from "@/app/vpn-context";
export { useVpn } from "@/app/vpn-context";

function useVpnData() {
  const profileState = useProfiles();
  const { load, setSelection, profiles, selection } = profileState;
  const [settings, setSettings] = useState<AppSettings>(pendingSettings);
  const [loaded, setLoaded] = useState(!hasNativeRuntime());
  const [profileEncryption, setProfileEncryption] = useState<ProfileEncryptionStatus>();
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>({
    status: "idle",
  });
  const connectionEvents = useRef(0);
  const connectionRequest = useRef(0);
  const connectionQueue = useRef(Promise.resolve());
  const connectionNow = useRef(connection);
  const selectionNow = useRef(selection);
  selectionNow.current = selection;
  const wantsConnection = useRef(false);
  const selectionTicket = useRef(0);
  const previousSelection = useRef<string | null>(null);
  const reloadCounter = useRef(0);
  const [coreReloadRequest, setCoreReloadRequest] = useState<number | null>(
    null,
  );
  const applyConnection = useCallback((state: ConnectionState) => {
    connectionNow.current = state;
    if (state.status === "connected") wantsConnection.current = true;
    if (state.status === "idle") {
      wantsConnection.current = false;
      setCoreReloadRequest(null);
    }
    setConnection(state);
  }, []);
  const [connectionPending, setConnectionPending] = useState<
    "connect" | "disconnect" | "switch" | "reload" | null
  >(null);
  const [profilePings, setProfilePings] = useState<
    Record<string, number | null>
  >({});
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [unsupportedProfiles, setUnsupportedProfiles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!loaded || !hasNativeRuntime()) return;
    let cancelled = false;
    void invoke<Record<string, string>>("unsupported_profiles")
      .then((result) => { if (!cancelled) setUnsupportedProfiles(result ?? {}); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [loaded, profiles, settings.sni_spoof_enabled, settings.sni_spoof_value]);
  const [selectionIntent, setSelectionIntent] = useState(0);
  const lastSelectionIntent = useRef(0);
  const selectConnection = useCallback(
    (next: SetStateAction<Selection>) => {
      setSelection(next);
      setSelectionIntent((intent) => intent + 1);
    },
    [setSelection],
  );
  const current = useRef(settings);
  const revision = useRef(0);
  const saving = useRef(0);
  const queue = useRef(Promise.resolve());
  const replaceSettings = useCallback((next: AppSettings) => {
    current.current = { ...pendingSettings, ...next };
    setSettings(current.current);
  }, []);
  const reload = useCallback(async () => {
    if (!hasNativeRuntime()) return;
    const eventVersion = connectionEvents.current;
    try {
      const [stored, profiles, state, encryption] = await Promise.all([
        invoke<AppSettings>("get_settings"),
        load(),
        invoke<ConnectionState>("get_connection_state"),
        invoke<ProfileEncryptionStatus>("get_profile_encryption"),
      ]);
      replaceSettings(stored);
      if (connectionEvents.current === eventVersion) applyConnection(state);
      if (stored.last_selection) {
        const saved = stored.last_selection;
        setSelection(
          reconcileSelection(profiles, {
            domain: saved.domain,
            mode: saved.mode,
            profileId: saved.profile_id,
          }),
        );
      }
      setProfileEncryption(encryption);
      setError("");
      setLoaded(true);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [load, replaceSettings, setSelection, applyConnection]);
  useEffect(() => {
    void reload();
    if (!hasNativeRuntime()) return;
    void invoke<PluginInfo[]>("list_plugins")
      .then((items) => setPlugins(items ?? []))
      .catch(() => undefined);
    const stops = [
      listen("core-reload-requested", () => {
        setCoreReloadRequest(++reloadCounter.current);
      }),
      listen("settings-changed", (data) => {
        if (!saving.current) replaceSettings(eventPayload<AppSettings>(data));
      }),
      listen(EVENTS.state, (data) => {
        connectionEvents.current++;
        applyConnection(eventPayload<ConnectionState>(data));
      }),
      listen("plugins-changed", (data) =>
        setPlugins(eventPayload<PluginInfo[]>(data) ?? []),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [reload, replaceSettings, applyConnection]);
  const saveSettings = useCallback(
    (next: AppSettings, optimistic = true) => {
      if (!loaded)
        return Promise.reject(
          new Error(translate(currentLanguage(), "ui.settingsLoading")),
        );
      const version = ++revision.current;
      if (optimistic) replaceSettings(next);
      if (!hasNativeRuntime()) return Promise.resolve();
      saving.current += 1;
      const request = queue.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await invoke<AppSettings>("save_settings", {
            settings: next,
          });
          if (revision.current === version) replaceSettings(saved);
        }).catch(async (cause) => {
          if (revision.current === version) {
            const stored = await invoke<AppSettings>("get_settings").catch(() => null);
            if (stored && revision.current === version) replaceSettings(stored);
          }
          throw cause;
        });
      queue.current = request.catch(() => undefined);
      return request.finally(() => {
        saving.current -= 1;
      });
    },
    [loaded, replaceSettings],
  );
  const patchSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      void saveSettings({ ...current.current, ...patch }).catch((cause) =>
        toast.error(errorMessage(cause)),
      );
    },
    [saveSettings],
  );
  useEffect(() => {
    if (!loaded || !profiles.length || !hasNativeRuntime()) return;
    const next = {
      domain: selection.domain,
      mode: selection.mode,
      profile_id: selection.profileId,
      profile_name:
        profiles.find((profile) => profile.id === selection.profileId)?.name ??
        "",
    };
    const saved = current.current.last_selection;
    if (
      saved?.domain === next.domain &&
      saved.mode === next.mode &&
      saved.profile_id === next.profile_id &&
      saved.profile_name === next.profile_name
    )
      return;
    patchSettings({ last_selection: next });
  }, [loaded, profiles, selection, patchSettings]);

  // Serialize core operations. Rapid selections supersede queued older choices.
  const runConnection = useCallback(
    (
      pending: Exclude<typeof connectionPending, null>,
      action: () => Promise<ConnectionState | null>,
    ) => {
      connectionRequest.current++;
      const request = connectionQueue.current
        .catch(() => undefined)
        .then(async () => {
          setConnectionPending(pending);
          await queue.current;
          const requestedReload = reloadCounter.current;
          const eventVersion = connectionEvents.current;
          const state = await action();
          if (!state) return;
          if (connectionEvents.current === eventVersion) applyConnection(state);
          if (state.status === "connected" || state.status === "idle") {
            setCoreReloadRequest((current) =>
              current !== null && current <= requestedReload ? null : current,
            );
          }
        });
      connectionQueue.current = request.catch(() => undefined);
      return request.finally(() => {
        connectionRequest.current--;
        if (!connectionRequest.current) setConnectionPending(null);
      });
    },
    [applyConnection],
  );

  useEffect(() => {
    if (!loaded) {
      previousSelection.current = null;
      return;
    }
    const key = JSON.stringify([
      selection.domain,
      selection.mode,
      selection.profileId,
    ]);
    const previous = previousSelection.current;
    const explicit = lastSelectionIntent.current !== selectionIntent;
    lastSelectionIntent.current = selectionIntent;
    previousSelection.current = key;
    if (previous === null || (previous === key && !explicit)) return;
    if (
      previous === key &&
      selection.mode === "manual" &&
      selection.profileId === connectionNow.current.profile_id
    )
      return;
    const ticket = ++selectionTicket.current;
    if (!wantsConnection.current || !hasNativeRuntime()) return;
    void runConnection("switch", async () => {
      if (ticket !== selectionTicket.current || !wantsConnection.current)
        return null;
      const target = selectionNow.current;
      return invoke<ConnectionState>(
        connectionNow.current.status === "connected"
          ? "switch_connection"
          : "connect",
        {
          sourceDomain: target.domain,
          mode: target.mode,
          profileId: target.profileId,
        },
      );
    }).catch((cause) => toast.error(errorMessage(cause)));
  }, [
    loaded,
    selection.domain,
    selection.mode,
    selection.profileId,
    selectionIntent,
    runConnection,
  ]);

  const toggleConnection = useCallback(async () => {
    if (!loaded || connectionRequest.current) return;
    const state = connectionNow.current;
    const disconnecting =
      state.status === "connected" ||
      state.status === "connecting" ||
      state.blocked;
    wantsConnection.current = !disconnecting;
    selectionTicket.current++;
    await runConnection(disconnecting ? "disconnect" : "connect", () => {
      if (disconnecting) return invoke<ConnectionState>("disconnect");
      const target = selectionNow.current;
      return invoke<ConnectionState>("connect", {
        sourceDomain: target.domain,
        mode: target.mode,
        profileId: target.profileId,
      });
    });
  }, [loaded, runConnection]);

  const dismissCoreReload = useCallback(() => setCoreReloadRequest(null), []);
  const reloadCore = useCallback(() => {
    setCoreReloadRequest(null);
    void runConnection("reload", () =>
      wantsConnection.current
        ? invoke<ConnectionState>("reload_core")
        : Promise.resolve(null),
    ).catch((cause) => toast.error(errorMessage(cause)));
  }, [runConnection]);

  const probeProfiles = useCallback(
    async (sourceDomain: string, profileIds: string[] = []) => {
      const pings = await invoke<ProfilePing[]>("probe_profiles_connectivity", {
        sourceDomain,
        profileIds,
        timeoutMs: 5000,
      });
      setProfilePings((previous) => ({
        ...previous,
        ...Object.fromEntries(pings.map(({ id, ping_ms }) => [id, ping_ms])),
      }));
    },
    [],
  );
  return useMemo(
    () => ({
      ...profileState,
      profileEncryption,
      setProfileEncryption,
      unsupportedProfiles,
      setSelection: selectConnection,
      settings,
      loaded,
      error,
      connection,
      connectionPending,
      toggleConnection,
      coreReloadRequest,
      dismissCoreReload,
      reloadCore,
      profilePings,
      probeProfiles,
      plugins,
      setPlugins,
      reload,
      replaceSettings,
      saveSettings,
      patchSettings,
    }),
    [
      profileState,
      profileEncryption,
      unsupportedProfiles,
      selectConnection,
      settings,
      loaded,
      error,
      connection,
      connectionPending,
      toggleConnection,
      coreReloadRequest,
      dismissCoreReload,
      reloadCore,
      profilePings,
      probeProfiles,
      plugins,
      reload,
      replaceSettings,
      saveSettings,
      patchSettings,
    ],
  );
}
export type VpnContextValue = ReturnType<typeof useVpnData>;
export function VpnProvider({ children }: { children: ReactNode }) {
  const value = useVpnData();
  return (
    <VpnContext.Provider value={value}>
      {children}
      <CoreReloadDialog />
    </VpnContext.Provider>
  );
}

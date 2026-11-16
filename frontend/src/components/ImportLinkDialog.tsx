import { useEffect, useState } from "react";
import { useVpn } from "@/app/vpn-context";
import AddModal from "@/components/AddModal";
import { EVENTS, invoke, listen } from "@/lib/backend";
import { hasNativeRuntime } from "@/lib/platform";

export function ImportLinkDialog() {
  const { loaded, profileEncryption, addProfile, importSubscription } = useVpn();
  const [request, setRequest] = useState<{ link: string; id: number }>();

  useEffect(() => {
    if (!loaded || profileEncryption?.locked || !hasNativeRuntime()) return;
    let active = true;
    let queue = Promise.resolve();
    let id = 0;

    // The backend queues the incoming URL before firing the event. Read the
    // queue on startup too, so a URL that launched Kage still opens the dialog.
    const read = () => {
      queue = queue.then(async () => {
        if (!active) return;
        const link = await invoke<string>("take_pending_link");
        if (active && link) setRequest({ link, id: ++id });
      }).catch(() => undefined);
    };

    const stop = listen(EVENTS.importLink, read);
    read();
    return () => {
      active = false;
      stop();
    };
  }, [loaded, profileEncryption?.locked]);

  if (!request) return null;
  return (
    <AddModal
      key={request.id}
      isOpen
      initialLink={request.link}
      onClose={() => setRequest((current) => current === request ? undefined : current)}
      onSaveProfile={async (name, link) => { await addProfile(name, link); }}
      onImportSubscription={async (url) => { await importSubscription(url); }}
    />
  );
}

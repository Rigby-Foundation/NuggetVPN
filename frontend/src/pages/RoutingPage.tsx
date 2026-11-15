import RoutingView from "@/components/views/RoutingView";
import "@/components/routing/canvas.css";
import { useVpn } from "@/app/VpnProvider";
export default function RoutingPage() {
  const { settings, profiles, connection, patchSettings, replaceSettings } =
    useVpn();
  return (
    <div className="relative h-full min-h-[420px]">
      <RoutingView
        settings={settings}
        onChange={patchSettings}
        onReplace={replaceSettings}
        profiles={profiles}
        connected={connection.status === "connected"}
      />
    </div>
  );
}

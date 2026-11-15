import { useVpn } from "@/app/vpn-context";
import { useT } from "@/lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function CoreReloadDialog() {
  const t = useT();
  const vpn = useVpn();
  return (
    <AlertDialog
      open={
        vpn.coreReloadRequest !== null &&
        vpn.connection.status === "connected" &&
        !vpn.connectionPending
      }
      onOpenChange={(open) => {
        if (!open) vpn.dismissCoreReload();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("connection.reload.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("connection.reload.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("connection.reload.later")}</AlertDialogCancel>
          <AlertDialogAction onClick={vpn.reloadCore}>
            {t("connection.reload.now")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

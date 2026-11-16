import { useId, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { useVpn } from "@/app/vpn-context";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsField, SettingsGroup } from "@/components/settings/shell";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { isAndroid, isIOS } from "@/lib/platform";
import type { ProfileEncryptionStatus } from "@/types";

type Action = "enable" | "unlock" | "disable";
const commands = {
  enable: "enable_profile_encryption",
  unlock: "unlock_profiles",
  disable: "disable_profile_encryption",
} as const;

function PasswordForm({ action, onDone, onCancel, onBusy }: {
  action: Action;
  onDone: (status: ProfileEncryptionStatus) => void | Promise<void>;
  onCancel?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [strength, setStrength] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabling = action === "enable";

  const submit = async () => {
    if (busy || !password) return;
    if (enabling && password !== confirmation) {
      setError(t("profileEncryption.mismatch"));
      return;
    }
    setError("");
    setBusy(true);
    onBusy?.(true);
    try {
      const status = await invoke<ProfileEncryptionStatus>(commands[action], { password, strength });
      setPassword("");
      setConfirmation("");
      await onDone(status);
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message === "the password is incorrect or the encrypted profiles have been changed"
        ? t("profileEncryption.authFailed")
        : message === "the saved profile file could not be opened"
          ? t("profileEncryption.unavailable")
          : message);
      if (!enabling) setPassword("");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-xs font-medium">{t("profileEncryption.password")}</label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          required
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {enabling && (
        <>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-confirm`} className="text-xs font-medium">{t("profileEncryption.confirm")}</label>
            <Input
              id={`${id}-confirm`}
              type="password"
              autoComplete="off"
              required
              disabled={busy}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label id={`${id}-strength`} className="text-xs font-medium">{t("profileEncryption.strength")}</label>
            <Select
              value={strength}
              disabled={busy}
              onValueChange={(value) => { if (value) setStrength(value); }}
              items={{
                standard: t("profileEncryption.standard"),
                high: t("profileEncryption.high"),
              }}
            >
              <SelectTrigger className="w-full" aria-labelledby={`${id}-strength`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t("profileEncryption.standard")}</SelectItem>
                <SelectItem value="high">{t("profileEncryption.high")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t("common.cancel")}</Button>}
        <Button type="submit" className={onCancel ? undefined : "w-full"} disabled={busy || !password || (enabling && !confirmation)}>
          {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
          {t(`profileEncryption.${action}`)}
        </Button>
      </div>
    </form>
  );
}

export function ProfileEncryptionSettings() {
  const t = useT();
  const { profileEncryption, setProfileEncryption } = useVpn();
  const [action, setAction] = useState<"enable" | "disable">();
  const [busy, setBusy] = useState(false);
  if (!profileEncryption) return null;
  return (
    <>
      <SettingsGroup>
        <SettingsField
          label={t("profileEncryption.title")}
          description={t(profileEncryption.enabled ? "profileEncryption.enabled" : "profileEncryption.description")}
          control={(
            <Button variant="outline" onClick={() => setAction(profileEncryption.enabled ? "disable" : "enable")}>
              {t(profileEncryption.enabled ? "profileEncryption.disable" : "profileEncryption.enable")}
            </Button>
          )}
        />
      </SettingsGroup>
      {action && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setAction(undefined); }}>
          <DialogContent initialFocus={isAndroid || isIOS ? false : undefined} showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t(`profileEncryption.${action}`)}</DialogTitle>
              <DialogDescription>{t(action === "enable" ? "profileEncryption.setup" : "profileEncryption.disableDescription")}</DialogDescription>
            </DialogHeader>
            <PasswordForm
              action={action}
              onBusy={setBusy}
              onCancel={() => setAction(undefined)}
              onDone={(status) => {
                setProfileEncryption(status);
                setAction(undefined);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function LockedProfiles({ unavailable }: { unavailable: boolean }) {
  const t = useT();
  const { reload, setProfileEncryption } = useVpn();
  return (
    <div className="grid min-h-full place-items-center p-4 sm:p-8">
      <section className="w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-card p-5 sm:p-6" aria-labelledby="locked-profiles">
        <div className="space-y-2">
          <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <LockKeyhole size={18} aria-hidden="true" />
          </div>
          <h1 id="locked-profiles" className="text-lg font-semibold">{t("profileEncryption.locked")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(unavailable ? "profileEncryption.unavailable" : "profileEncryption.unlockDescription")}
          </p>
        </div>
        {!unavailable && <PasswordForm action="unlock" onDone={async (status) => {
          await reload();
          setProfileEncryption(status);
        }} />}
      </section>
    </div>
  );
}

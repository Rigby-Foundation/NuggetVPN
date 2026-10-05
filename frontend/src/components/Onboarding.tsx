import { useState } from "react";
import toast from "react-hot-toast";
import { invoke } from "@/lib/backend";
import { Server, ArrowRight, Loader2 } from "lucide-react";
import { AppSettings, Profile } from "../types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useT } from "@/lib/i18n";

interface OnboardingProps {
  settings: AppSettings;
  onComplete: () => void;
  onSettingsChange: (settings: AppSettings) => void;
}

function Onboarding({
  settings,
  onComplete,
  onSettingsChange,
}: OnboardingProps) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:3001");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  // Good news, shown apart from the error box rather than in it.
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSkip = async () => {
    setIsLoading(true);
    try {
      const newSettings = { ...settings, skip_auth: true };
      await invoke("save_settings", { settings: newSettings });
      onSettingsChange(newSettings);
    } catch (e) {
      console.error("Failed to save settings on skip:", e);
    } finally {
      setIsLoading(false);
      onComplete();
    }
  };

  const checkServer = async () => {
    setIsLoading(true);
    setError("");
    try {
      let url = serverUrl;
      if (!url.startsWith("http")) {
        url = "http://" + url;
        setServerUrl(url);
      }
      setStep(1);
    } catch (_e) {
      setError(t("onboarding.unreachable"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async () => {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      if (isRegistering) {
        await invoke("register_user", {
          server: serverUrl,
          username,
          password,
        });
        setIsRegistering(false);
        setNotice(t("onboarding.registered"));
        setIsLoading(false);
        return;
      }

      const token = await invoke<string>("login_user", {
        server: serverUrl,
        username,
        password,
      });

      if (token) {
        const newSettings: AppSettings = {
          ...settings,
          auth_server: serverUrl,
          auth_token: token,
          skip_auth: false,
        };

        const profiles = (await invoke("get_profiles")) as Profile[];

        if (profiles.length > 0) {
          newSettings.pending_sync_upload = true;
          await invoke("save_settings", { settings: newSettings });
          onSettingsChange(newSettings);
          // A toast in the app's own style, not the browser's alert() box.
          toast.success(t("onboarding.restartToUpload"), { duration: 8000 });
        } else {
          try {
            await invoke("pull_profiles_from_server", { settings: newSettings });
          } catch (e) {
            console.error("Failed to pull profiles:", e);
          }
          await invoke("save_settings", { settings: newSettings });
          onSettingsChange(newSettings);
        }

        onComplete();
      }
    } catch (e: unknown) {
      setError(String(e) || t("onboarding.failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/40 backdrop-blur-2xl flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <Card className="w-full max-w-md border-border/50 shadow-2xl my-auto">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
            <Server size={32} />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-black tracking-tight">
              {t("onboarding.title")}
            </CardTitle>
            <CardDescription className="text-base">
              {step === 0
                ? t("onboarding.subtitle")
                : isRegistering
                  ? t("onboarding.createAccountTitle")
                  : t("onboarding.signInTitle")}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <Alert className="mb-6">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          {step === 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="server-url">{t("onboarding.server")}</Label>
                <Input
                  id="server-url"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://your-server.com:3001"
                  className="h-12"
                />
              </div>

              <Button
                onClick={checkServer}
                disabled={isLoading}
                className="w-full h-12 text-base font-bold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("onboarding.checking")}
                  </>
                ) : (
                  <>
                    {t("common.continue")} <ArrowRight size={18} className="ms-2 rtl:-scale-x-100" />
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t("onboarding.username")}</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("onboarding.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12"
                />
              </div>

              <Button
                onClick={handleAuth}
                disabled={isLoading}
                className="w-full h-12 text-base font-bold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t("common.working")}
                  </>
                ) : isRegistering ? (
                  t("onboarding.createAccount")
                ) : (
                  t("onboarding.signIn")
                )}
              </Button>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-muted-foreground"
                >
                  {t("common.back")}
                </Button>
                <Button
                  variant="link"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setError("");
                    setNotice("");
                  }}
                  className="text-primary"
                >
                  {isRegistering ? t("onboarding.haveAccount") : t("onboarding.needAccount")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-center pt-0 pb-6 px-6">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            disabled={isLoading}
            className="w-full text-muted-foreground min-h-[48px] py-3 text-base active:opacity-70 cursor-pointer touch-manipulation select-none"
          >
            {t("onboarding.skip")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default Onboarding;

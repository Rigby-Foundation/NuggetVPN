import { useState } from "react";
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
  const [step, setStep] = useState(0);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:3001");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSkip = async () => {
    const newSettings = { ...settings, skip_auth: true };
    await invoke("save_settings", { settings: newSettings });
    onComplete();
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
      setError("Could not reach server");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async () => {
    setIsLoading(true);
    setError("");
    try {
      if (isRegistering) {
        await invoke("register_user", {
          server: serverUrl,
          username,
          password,
        });
        setIsRegistering(false);
        setError("Registration successful! Please log in.");
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
          alert(
            "Sync configured! Please restart the application to upload your profiles."
          );
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
      setError(String(e) || "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/40 backdrop-blur-2xl flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border/50 shadow-2xl">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
            <Server size={32} />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-black tracking-tight">
              Welcome to NuggetVPN
            </CardTitle>
            <CardDescription className="text-base">
              {step === 0
                ? "Connect to your sync server to get started"
                : isRegistering
                  ? "Create your account"
                  : "Sign in to your account"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="server-url">SERVER URL</Label>
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={18} className="ml-2" />
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">USERNAME</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">PASSWORD</Label>
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : isRegistering ? (
                  "Create Account"
                ) : (
                  "Sign In"
                )}
              </Button>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(0)}
                  className="text-muted-foreground"
                >
                  Back
                </Button>
                <Button
                  variant="link"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setError("");
                  }}
                  className="text-primary"
                >
                  {isRegistering ? "Already have an account?" : "Need an account?"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-center pt-0">
          <Button
            variant="ghost"
            onClick={handleSkip}
            className="w-full text-muted-foreground"
          >
            Skip Synchronization
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default Onboarding;

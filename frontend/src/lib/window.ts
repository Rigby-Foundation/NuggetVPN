import { Call } from "@wailsio/runtime";
import { hasNativeRuntime } from "@/lib/platform";

const SERVICE = "github.com/Rigby-Foundation/NuggetVPN/internal/app.App";

type WindowAction = "RequestClose" | "MinimiseWindow" | "ToggleMaximiseWindow";

export async function windowAction(action: WindowAction) {
  // Browser previews display the host's controls without affecting the browser.
  if (!hasNativeRuntime()) return;
  try {
    await Call.ByName(`${SERVICE}.${action}`);
  } catch (error) {
    console.error(`Window action ${action} failed`, error);
  }
}

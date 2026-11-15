export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

type PlatformNavigator = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & {
  userAgentData?: { platform: string };
};

export function detectPlatform(device: PlatformNavigator, hostOS?: string): Platform {
  if (hostOS === "darwin" || hostOS === "macos") return "macos";
  if (["windows", "linux", "android", "ios"].includes(hostOS ?? "")) {
    return hostOS as Platform;
  }

  // iPadOS can identify itself as a Mac when requesting desktop websites.
  if (/iPhone|iPad|iPod/i.test(device.userAgent) ||
      (/Mac/i.test(device.platform) && device.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(device.userAgent)) return "android";

  const identity = `${device.userAgentData?.platform ?? device.platform} ${device.userAgent}`;
  if (/Mac/i.test(identity)) return "macos";
  if (/Win/i.test(identity)) return "windows";
  if (/Linux|X11/i.test(identity)) return "linux";
  return "unknown";
}

export function hasNativeRuntime() {
  const host = window as Window & {
    _wails?: { environment?: { OS?: string } };
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    wails?: { invoke?: unknown };
  };
  return Boolean(host._wails?.environment || host.chrome?.webview?.postMessage ||
    host.webkit?.messageHandlers?.external?.postMessage || host.wails?.invoke);
}

export function getPlatform(): Platform {
  const host = window as Window & { _wails?: { environment?: { OS?: string } } };
  return detectPlatform(navigator, host._wails?.environment?.OS);
}

export const isAndroid = getPlatform() === "android";
export const isIOS = getPlatform() === "ios";

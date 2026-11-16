import { useSyncExternalStore } from "react";
import { isAndroid, isIOS } from "@/lib/platform";

const narrow = window.matchMedia("(max-width: 767px)");
const phone = (isAndroid || isIOS) && Math.min(screen.width, screen.height) < 600;

function subscribe(onChange: () => void) {
  narrow.addEventListener("change", onChange);
  return () => narrow.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => phone || narrow.matches);
}

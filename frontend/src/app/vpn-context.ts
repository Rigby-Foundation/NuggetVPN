import { createContext, useContext } from "react";
import type { VpnContextValue } from "@/app/VpnProvider";
// Keep context identity stable when Vite refreshes the provider or its consumers.
export const VpnContext = createContext<VpnContextValue | null>(null);
export function useVpn() {
  const value = useContext(VpnContext);
  if (!value) throw new Error("useVpn requires VpnProvider");
  return value;
}

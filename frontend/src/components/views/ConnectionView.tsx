import {ArrowDown, ArrowUp, Clock, Rss, Power} from "lucide-react";

import { IpInfo } from "@/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {Suspense} from "react";

interface ConnectionViewProps {
  isConnected: boolean;
  toggleVpn: () => void;
  duration: string;
  uploadSpeed: string;
  downloadSpeed: string;
  totalUp: string;
  totalDown: string;
  checkIp: () => void;
  isCheckingIp: boolean;
  ipInfo: IpInfo | null;
}

function ConnectionView({
  isConnected,
  toggleVpn,
  duration,
  uploadSpeed,
  downloadSpeed,
  totalUp,
  totalDown,
  checkIp,
  isCheckingIp,
  ipInfo,
}: ConnectionViewProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" />

      <div className="relative z-10 my-12">
        <button
          onClick={toggleVpn}
          className={`group relative w-56 h-56 rounded-full flex items-center justify-center transition-all duration-500 outline-none ${
            isConnected ? "scale-105" : "hover:scale-[1.02]"
          }`}
        >
          <div className="absolute inset-0 rounded-full border border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-xl" />
          <div
            className={`absolute inset-3 rounded-full transition-all duration-700 overflow-hidden flex items-center justify-center ${
              isConnected
                ? "bg-gradient-to-tr from-amber-500 to-orange-500 shadow-[0_0_60px_rgba(249,115,22,0.4)]"
                : "bg-white/5 dark:bg-black/10 backdrop-blur-md border border-white/10 shadow-inner"
            }`}
          >
            {isConnected && (
              <div className="absolute inset-0 bg-black/10 animate-pulse" />
            )}
            <Power
              size={64}
              strokeWidth={1.5}
              className={`relative z-10 transition-all duration-500 ${
                isConnected
                  ? "drop-shadow-md scale-110"
                  : "text-muted-foreground group-hover:text-primary"
              }`}
            />
          </div>
        </button>
      </div>

      {isConnected && (
          <div className="flex items-center w-full max-w-[65vw]">
            <div className="grid grid-cols-4 gap-4 w-full">
              <div className="flex items-center justify-center gap-4">
                <ArrowUp size={24} className="text-red-500" />
                <p>{uploadSpeed}</p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <ArrowDown size={24} className="text-green-500" />
                <p>{downloadSpeed}</p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <Clock size={24} />
                <p>{duration}</p>
              </div>
              <div className="flex items-center justify-center gap-4">
                <Rss size={24} />
                {isCheckingIp ? (
                    <p className="text-muted-foreground">Checking…</p>
                ) : ipInfo ? (
                    <p>{ipInfo.ip}</p>
                ) : (
                    <p className="text-muted-foreground">—</p>
                )}
              </div>
            </div>
          </div>
      )}

      {!isConnected && (
        <div className="h-[52px] flex items-center justify-center text-muted-foreground text-sm z-10">
          Ready to connect
        </div>
      )}
    </div>
  );
}

export default ConnectionView;

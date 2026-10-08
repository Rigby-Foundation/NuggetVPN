import { AppWindow, Cpu } from "lucide-react";

/** A program's own icon where its file has one; a generic one otherwise. */
export function AppIcon({ icon, system }: { icon?: string; system?: boolean }) {
    if (icon) return <img src={icon} alt="" className="h-4 w-4 shrink-0 object-contain" draggable={false} />;
    const Icon = system ? Cpu : AppWindow;
    return <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
}

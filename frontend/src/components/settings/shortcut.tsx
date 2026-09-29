import { KeyboardEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errorMessage, invoke } from "@/lib/backend";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The key part of a shortcut, from a key event: A–Z, 0–9 or F1–F24. */
function keyName(event: KeyboardEvent): string | null {
    const code = event.code;
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    return null;
}

/**
 * Records a system-wide shortcut: click, press the keys. It is registered as
 * soon as it is pressed, so a combination another app already holds is
 * reported right there.
 */
export function ShortcutRecorder({ value, onSaved }: { value: string; onSaved: (spec: string) => void }) {
    const t = useT();
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState("");
    const [held, setHeld] = useState("");

    useEffect(() => {
        if (!recording) setHeld("");
    }, [recording]);

    const save = async (spec: string) => {
        setError("");
        try {
            const saved = await invoke<string>("set_global_shortcut", { spec });
            onSaved(saved);
        } catch (reason) {
            setError(errorMessage(reason));
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!recording) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
            setRecording(false);
            return;
        }
        const modifiers = [
            event.ctrlKey ? "Ctrl" : "",
            event.altKey ? "Alt" : "",
            event.shiftKey ? "Shift" : "",
            event.metaKey ? "Super" : "",
        ].filter(Boolean);
        const key = keyName(event);
        setHeld([...modifiers, key ?? ""].filter(Boolean).join("+"));
        if (!key) return;
        if (!event.ctrlKey && !event.altKey && !event.metaKey) {
            setError(t("shortcut.needsModifier"));
            return;
        }
        setRecording(false);
        void save([...modifiers, key].join("+"));
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        setError("");
                        setRecording(true);
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => setRecording(false)}
                    className={cn("min-w-36 font-mono", recording && "border-primary text-primary")}
                >
                    {recording ? held || t("shortcut.press") : value || t("shortcut.none")}
                </Button>
                {value && !recording ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => void save("")}
                        aria-label={t("shortcut.clear")}
                    >
                        <X size={14} aria-hidden="true" />
                    </Button>
                ) : null}
            </div>
            {error ? <p className="max-w-64 text-end text-[11px] text-status-error">{error}</p> : null}
        </div>
    );
}

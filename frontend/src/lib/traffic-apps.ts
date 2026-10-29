import { isSystemProgram } from "@/lib/system-apps";

export const SYSTEM_PROGRAM = "\u0001system";
type ProgramUsage = { program: string; up: number; down: number };

/** Fold Chromium/Electron helpers into their app without losing byte totals. */
export function groupTrafficApps(programs: ProgramUsage[], showSystem: boolean) {
    const grouped = new Map<string, ProgramUsage & { iconProgram: string }>();
    for (const usage of programs) {
        const bundle = usage.program.match(/(?:^|\/)([^/]+)\.app\//)?.[1];
        const program = !showSystem && isSystemProgram(usage.program) ? SYSTEM_PROGRAM
            : (bundle ?? usage.program).replace(/\.exe$/i, "").replace(/ Helper(?: \([^)]*\))?$/i, "");
        const current = grouped.get(program);
        if (current) {
            current.up += usage.up;
            current.down += usage.down;
        } else {
            grouped.set(program, { program, up: usage.up, down: usage.down, iconProgram: usage.program });
        }
    }
    return [...grouped.values()].sort((a, b) => b.up + b.down - a.up - a.down);
}

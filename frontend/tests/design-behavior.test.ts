import { describe, expect, test } from "bun:test";
import { serverSelection } from "../src/lib/server-selection";
import { groupTrafficApps, SYSTEM_PROGRAM } from "../src/lib/traffic-apps";
import type { Profile } from "../src/types";

const profiles = [
    { id: "fast", name: "Netherlands", source_domain: "example.test" },
    { id: "active", name: "Germany", source_domain: "example.test" },
    { id: "unsupported", name: "Poland", source_domain: "example.test" },
    { id: "other", name: "Another subscription", source_domain: "other.test" },
] as Profile[];
const input = { profiles, pings: { fast: 30, active: 45, unsupported: 5, other: 1 }, domain: "example.test", mode: "auto" as const,
    profileId: "", unsupported: { unsupported: "Unsupported transport" } };

describe("server identity and recommendations", () => {
    test("recommends only a measured, supported server in this subscription", () => {
        expect(serverSelection(input).displayed?.id).toBe("fast");
    });
    test("a connected tunnel reports the backend's server, even if another is faster", () => {
        expect(serverSelection({ ...input, state: { status: "connected", profile_id: "active" } }).displayed?.id).toBe("active");
    });
    test("does not invent an active server if the backend names a removed profile", () => {
        expect(serverSelection({ ...input, state: { status: "connected", profile_id: "removed" } }).displayed).toBeUndefined();
    });
    test("missing or failed measurements do not become a recommendation", () => {
        expect(serverSelection({ ...input, pings: { fast: null, active: NaN, unsupported: 5 } }).best).toBeUndefined();
        expect(serverSelection({ ...input, pings: { fast: -1, active: Infinity } }).best).toBeUndefined();
    });
    test("stale manual selections cannot display a server from another subscription", () => {
        expect(serverSelection({ ...input, mode: "manual", profileId: "other" }).displayed).toBeUndefined();
    });
    test("manual selection keeps its identity despite a faster candidate", () => {
        expect(serverSelection({ ...input, mode: "manual", profileId: "active" }).displayed?.id).toBe("active");
    });
});

describe("traffic grouped by application", () => {
    const programs = [
        { program: "Discord", up: 10, down: 20 },
        { program: "Discord Helper (Renderer)", up: 30, down: 40 },
        { program: "Discord Helper", up: 50, down: 60 },
        { program: "Google Chrome Helper (Renderer)", up: 70, down: 80 },
        { program: "svchost.exe", up: 3, down: 4 },
        { program: "System", up: 5, down: 6 },
    ];
    test("merges helpers while preserving every uploaded and downloaded byte", () => {
        const result = groupTrafficApps(programs, false);
        expect(result.find((item) => item.program === "Discord")).toMatchObject({ up: 90, down: 120 });
        expect(result.find((item) => item.program === SYSTEM_PROGRAM)).toMatchObject({ up: 8, down: 10 });
        expect(result.reduce((sum, item) => sum + item.up + item.down, 0)).toBe(programs.reduce((sum, item) => sum + item.up + item.down, 0));
        expect(programs[0]).toEqual({ program: "Discord", up: 10, down: 20 });
    });
    test("system programs remain inspectable when requested", () => {
        const result = groupTrafficApps(programs, true);
        expect(result.some((item) => item.program === SYSTEM_PROGRAM)).toBe(false);
        expect(result.find((item) => item.program === "svchost")).toMatchObject({ up: 3, down: 4 });
    });
    test("recognizes helper executables inside an application bundle", () => {
        expect(groupTrafficApps([{ program: "/Applications/Discord.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper", up: 1, down: 2 }], false)[0].program).toBe("Discord");
    });
});

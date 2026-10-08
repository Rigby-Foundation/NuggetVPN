const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const BIT_UNITS = ["bit", "Kbit", "Mbit", "Gbit", "Tbit"];

export type RateUnit = "bytes" | "bits";
export type SizeUnit = "auto" | "KB" | "MB" | "GB";

/**
 * The units the user chose in Appearance. Module state rather than a prop:
 * dozens of places format numbers, and all of them should follow the one
 * choice. The appearance provider sets it (see applyAppearance), and the
 * re-render that follows a change picks it up everywhere.
 */
let units: { rate: RateUnit; size: SizeUnit } = { rate: "bytes", size: "auto" };
export function setUnits(next: { rate: RateUnit; size: SizeUnit }) {
    units = next;
}

/** hh:mm:ss for a duration in milliseconds. */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
        .map((part) => part.toString().padStart(2, "0"))
        .join(":");
}

/**
 * A byte count at a fixed width.
 *
 * Precision shrinks as the number grows so the string stays about the same
 * length: these are rendered in a row that updates every second, and a value
 * that changes width makes the whole row twitch.
 */
export function formatBytes(bytes: number): string {
    if (units.size !== "auto") return fixedBytes(bytes, units.size);
    return autoBytes(bytes);
}

/** In one unit whatever the size: numbers that never change unit, so never width. */
function fixedBytes(bytes: number, unit: Exclude<SizeUnit, "auto">): string {
    const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0) / 1024 ** UNITS.indexOf(unit);
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${unit}`;
}

function autoBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
    }
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        UNITS.length - 1
    );
    const value = bytes / 1024 ** exponent;
    const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${UNITS[exponent]}`;
}

/**
 * A per-second rate, in bytes or bits as chosen. It always picks its own
 * scale: a fixed unit for speeds would show 0.00 for anything slow.
 */
export function formatRate(bytesPerSecond: number): string {
    if (units.rate === "bits") {
        // Network speeds are decimal: a megabit is a million bits.
        const bits = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0) * 8;
        const exponent = bits < 1 ? 0 : Math.min(Math.floor(Math.log10(bits) / 3), BIT_UNITS.length - 1);
        const value = bits / 1000 ** exponent;
        const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
        return `${value.toFixed(decimals)} ${BIT_UNITS[exponent]}/s`;
    }
    return `${autoBytes(bytesPerSecond)}/s`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

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

/** A per-second rate. */
export function formatRate(bytesPerSecond: number): string {
    return `${formatBytes(bytesPerSecond)}/s`;
}

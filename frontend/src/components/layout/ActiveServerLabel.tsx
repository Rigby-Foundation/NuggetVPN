import { Flag } from "@/components/ui/flag";
import { countryOf, withoutFlagEmoji } from "@/lib/flags";

/**
 * The server picker's label in the top bar, the same in all three layouts.
 *
 * A chosen server shows its flag drawn like everywhere else, then its name
 * without the flag emoji, which Windows draws as two letters. The flag only
 * when the name says a country: a globe beside the server icon says nothing.
 * Screen readers get the name as the provider wrote it, emoji and all, since
 * the drawn flag is decoration to them.
 */
export function ActiveServerLabel({
    serverName,
    fallback,
    flagSize,
}: {
    /** The chosen server's name; unset in automatic mode or with none. */
    serverName?: string;
    /** What to show without one: "Automatic", or "None". */
    fallback: string;
    flagSize: number;
}) {
    if (!serverName) {
        return <span className="truncate">{fallback}</span>;
    }
    return (
        <>
            {countryOf(serverName) ? <Flag name={serverName} size={flagSize} className="shrink-0" /> : null}
            <span className="truncate" aria-hidden="true">
                {withoutFlagEmoji(serverName)}
            </span>
            <span className="sr-only">{serverName}</span>
        </>
    );
}

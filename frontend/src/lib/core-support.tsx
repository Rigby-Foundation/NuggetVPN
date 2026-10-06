import { createContext, useContext } from "react";

/**
 * The servers the chosen core cannot run, by profile id, each with the core's
 * own reason. Empty on the built-in core, which runs everything.
 *
 * Asked of the backend rather than worked out here: each core's converter is
 * what refuses a server at connect time, so asking it is the only way the
 * list and the refusal never disagree.
 */
const UnsupportedContext = createContext<Record<string, string>>({});

export const UnsupportedProvider = UnsupportedContext.Provider;

export function useUnsupported(): Record<string, string> {
    return useContext(UnsupportedContext);
}

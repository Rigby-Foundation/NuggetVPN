/**
 * Which kind of device the window is on, known before the backend answers.
 *
 * The mobile builds run the same page in a WebView, whose user agent says
 * Android or iPhone/iPad/iPod.
 */
export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
export const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isMobileDevice = isAndroid || isIOS;

/** MainActivity already keeps Android's WebView clear of the system bars. */
export const safeAreaInsets = {
    top: isAndroid ? "0px" : "env(safe-area-inset-top, 0px)",
    bottom: isAndroid ? "0px" : "env(safe-area-inset-bottom, 0px)",
};

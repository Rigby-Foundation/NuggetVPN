/**
 * Which kind of device the window is on, known before the backend answers.
 *
 * The mobile builds run the same page in a WebView, whose user agent says
 * Android or iPhone/iPad/iPod.
 */
export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
export const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isMobileDevice = isAndroid || isIOS;

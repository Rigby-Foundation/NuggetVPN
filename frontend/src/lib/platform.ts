/**
 * Which kind of device the window is on, known before the backend answers.
 *
 * The Android build runs the same page in a WebView, whose user agent says
 * Android; nothing else here does.
 */
export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

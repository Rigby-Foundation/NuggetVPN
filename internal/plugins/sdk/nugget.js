/*
 * NuggetVPN plugin SDK.
 *
 * Include it in a plugin page:
 *
 *     <script src="/plugins/_sdk/nugget.js"></script>
 *
 * and talk to the app through `nugget`:
 *
 *     const status = await nugget.call("vpn.status");
 *     nugget.on("vpn.state", (state) => { ... });
 *
 * The page runs in a sandboxed frame; this file is the only way out of it.
 * It also dresses the page in the app's theme: the theme's colours are set
 * as CSS variables (--background, --foreground, --primary, ...) on <html>,
 * with light or dark `color-scheme`, and kept current as the user changes
 * theme. Styles can use them directly.
 */
(function () {
    "use strict";
    var pending = new Map();
    var listeners = new Map();
    var nextId = 1;

    function send(message) {
        message.nugget = 1;
        window.parent.postMessage(message, "*");
    }

    window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.nugget !== 1) return;
        if (message.id !== undefined && pending.has(message.id)) {
            var waiter = pending.get(message.id);
            pending.delete(message.id);
            if (message.error !== undefined) waiter.reject(new Error(message.error));
            else waiter.resolve(message.result);
            return;
        }
        if (typeof message.event === "string") {
            if (message.event === "app.theme") applyTheme(message.data);
            var handlers = listeners.get(message.event);
            if (handlers) {
                handlers.forEach(function (handler) {
                    try {
                        handler(message.data);
                    } catch (error) {
                        console.error(error);
                    }
                });
            }
        }
    });

    function applyTheme(theme) {
        if (!theme || typeof theme !== "object") return;
        var root = document.documentElement;
        Object.keys(theme.colors || {}).forEach(function (name) {
            root.style.setProperty("--" + name, theme.colors[name]);
        });
        if (theme.font) root.style.setProperty("--font", theme.font);
        if (theme.radius) root.style.setProperty("--radius", theme.radius);
        root.style.colorScheme = theme.mode === "light" ? "light" : "dark";
        root.dataset.theme = theme.mode === "light" ? "light" : "dark";
        if (theme.dir) root.dir = theme.dir;
        if (theme.language) root.lang = theme.language;
    }

    var nugget = {
        /** Calls an app method; resolves with its result. */
        call: function (method, params) {
            return new Promise(function (resolve, reject) {
                var id = nextId++;
                pending.set(id, { resolve: resolve, reject: reject });
                send({ id: id, method: String(method), params: params === undefined ? null : params });
            });
        },
        /** Listens for an app event; returns a function that stops listening. */
        on: function (event, handler) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
            send({ subscribe: String(event) });
            return function () {
                var handlers = listeners.get(event);
                if (handlers) handlers.delete(handler);
            };
        },
        /** Asks the app to size this panel to the page's content. */
        fit: function () {
            send({ height: contentHeight() });
        },
    };
    window.nugget = nugget;

    // The body, not <html>: <html> is always at least as tall as the frame,
    // so measuring it would let a panel grow but never shrink.
    function contentHeight() {
        var body = document.body;
        if (!body) return 0;
        var margin = parseFloat(getComputedStyle(body).marginBottom) || 0;
        return Math.ceil(body.getBoundingClientRect().bottom + margin + window.scrollY);
    }

    // The theme first, so the page is never drawn in the wrong colours for
    // long; then the panel's height, as it changes.
    send({ hello: true });
    if (typeof ResizeObserver === "function") {
        var observe = function () {
            new ResizeObserver(function () {
                nugget.fit();
            }).observe(document.body);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
        else observe();
    }
})();

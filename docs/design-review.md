# VPN client design review

Reviewed and implemented on 29 October 2026. This pass covers the six main screens, all 14 settings sections, and the principal setup, import, editing and export dialogs.

## Main changes

| Area | Finding | Implemented change |
| --- | --- | --- |
| Connection state | Leaving Home hid the tunnel state. | Persistent text and status icon in every navigation layout, including reconnecting and kill-switch blocking. |
| Server identity | Automatic selection did not identify its destination clearly. | Shared picker shows a measured recommendation while idle and the backend's actual server while connected. The Home destination opens the picker. |
| Desktop density | Large cards and unconstrained content made lists slow to scan. | Compact server rows, aligned latency, consistent content widths, and a narrower settings reading column. Mobile secondary server actions move into a menu. |
| Navigation | Connections, proxies and configuration overlapped in meaning. | Home, Servers, Profiles, Routing, Activity and Settings labels; “Network connections” identifies the traffic inspector. Desktop action says “Connect”. |
| Routing | Configured destinations could be mistaken for current tunnel activity; graph editing was the only prominent view. | Graph/Rules switch, ordered readable rules with values and move controls, click through to graph editing, explicit configured default destination, and “Uses the tunnel when connected” wording. |
| Statistics | Helper processes overwhelmed the application list; health was buried below it. | Merge Chromium/Electron helpers into their application while preserving byte totals, show the top eight with an all-apps option, and provide a separate Server health view. |

## Settings coverage

All sections received the shared reading-width, spacing and navigation treatment. Detail pages have a section jump menu and an automatic-save explanation.

| Section | Review and outcome |
| --- | --- |
| Appearance | Split the long page into Theme, Layout, Font, Page transition and Units. Corners sit with Font; charts sit with Units. Preserve per-tab scroll position and search destinations. Simplify layout terminology. Phone layouts fall back to Theme when a desktop-only tab was remembered. |
| Language | Checked language choices and the shared detail layout. Added new strings to English, Russian, Ukrainian, Chinese, Japanese and Persian catalogs. |
| Behaviour | Checked startup, reconnect, close-action and kill-switch descriptions. Clarified that keeping the app running preserves the tunnel and quitting disconnects it. |
| Updates | Checked version, update controls and their hierarchy. No update was installed during review. |
| Connection | Bound the MTU and DNS field widths to their content and added explicit accessible names. |
| TLS and obfuscation | Reviewed unavailable controls under Xray. Added a direct Core action to the unsupported-feature explanation. |
| Proxy chain | Reviewed its disabled state, enable control and dependent fields. |
| Subscription identity | Renamed the ambiguous settings entry; reviewed the user agent and device identity controls. |
| Wi-Fi | Reviewed the hidden-SSID explanation and conditional connection controls. |
| Privacy | Reviewed IP lookup, logs, application statistics and server-health choices. |
| Synchronisation | Reviewed the disconnected page and setup dialog. Sized the connect action appropriately for desktop. |
| Backup | Reviewed save/restore actions and explanatory copy. No user backup was overwritten or restored. |
| Core | Reviewed the four core choices and capability limitations. |
| Plugins | Reviewed the empty state and management entry points. No plugin was installed or removed. |

## Other surfaces

- Import: shorter connection-link label, supported-format hint, disabled empty submission, and QR action that does not wrap awkwardly.
- Server editor: localised title, associated select labels, certificate-switch accessible name, scroll containment and wrapping footer.
- Export: keyboard-operable format selector, clearer connection-settings language, localised actions and compact phone preview.
- Dialogs: viewport-bound height and scrolling, room for the close button, and consistent left-aligned headings.
- Initial setup and sync setup: modal focus containment and background isolation for keyboard and assistive-technology users.
- Network connections: informative bounded empty state.
- Shared controls: nested keyboard actions do not accidentally select their parent server row; segmented choices can scroll on narrow screens; navigation widths remain stable when selected.

## Validation

- `cd frontend && bun test tests/design-behavior.test.ts`: 9 tests, 14 assertions, all passing. Covers server identity, recommendation scope/capabilities/failure handling, stale selections and lossless application grouping.
- `cd frontend && bun run build`: TypeScript and production Vite build pass. Vite retains the existing large-chunk warning.
- `git diff --check`: passes.
- Visually inspected desktop bottom, top, left-sidebar and right-sidebar layouts; light and dark themes; connected, idle, connecting, reconnecting and blocked states; 390 × 844 phone layout, including Persian right-to-left rendering.
- Exercised Appearance tabs, settings jump navigation, statistics expansion and health, routing Rules-to-Graph navigation, mobile server menu/export, server editing, and the complete first-start setup. Checked modal focus and background isolation in the rendered DOM.

## Scope and limits

The installed macOS app supplied the original-design review. Updated source was checked in an isolated local browser preview with labelled sample data and a mocked native bridge. The installed app has **not** been rebuilt or replaced. VPN operation, OS permissions, real sync authentication, QR camera permissions, update installation, backup restoration and plugin installation were not exercised. No live network/security settings were changed.

Advanced protocol-specific form copy still contains some existing English technical labels. This pass localises the added UI and common editor labels; it is not a complete translation audit or formal accessibility certification.

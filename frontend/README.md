# Frontend pages

`src/app/pages.ts` is the single page registry. It generates routes and sidebar
links. The header and sidebar stay mounted while pages change. Routes use the URL
hash (`#/connection`), so refreshing works in Wails and the Vite preview.

## Add a page

1. Create a component with a default export in `src/pages/`:

   ```tsx
   import { Page } from "@/components/Page";

   export default function ProfilesPage() {
     return (
       <Page title="Profiles" description="Manage your profiles.">
         {/* Your page content */}
       </Page>
     );
   }
   ```

2. Import an icon from `lucide-react` in `src/app/pages.ts` and add an entry:

   ```tsx
   {
     path: "/profiles",
     title: "Profiles",
     icon: Folder,
     load: () => import("@/pages/ProfilesPage"),
     sidebar: { group: "Library" },
   },
   ```

That's all: the page is loaded on demand and the sidebar links to it automatically.
Registry order determines item order; items with the same group are shown together.
`Page` supplies consistent spacing and a heading, and accepts `description`,
`actions`, `className`, and children. It is optional for custom page layouts.

## Sidebar options

- `sidebar: {}`: show in the main sidebar without a group heading.
- `sidebar: { group: "Library" }`: show under a named group.
- `sidebar: { placement: "footer" }`: show at the bottom, like Settings.
- `sidebar: { label: "Custom label" }`: use a different navigation label.
- Omit `sidebar`: register a route without showing a sidebar link.
- `sidebar: { end: false }`: keep the link active on child URLs.
- `sidebar: { to: "/profiles" }`: use a concrete link for a wildcard route.

Paths must be unique and start with `/`. Keep `/` and `*` reserved for the home
redirect and missing-page fallback. To change the home page, update `defaultPage`.

## Navigation and details

Use React Router so links work without reloading the app:

```tsx
import { Link, useNavigate, useParams } from "react-router";

<Link to="/settings">Settings</Link>

// Inside a component:
const navigate = useNavigate();
navigate("/connection");
```

For detail pages, add a registry entry with a path such as `/profiles/:id` and
omit `sidebar`. Read its ID using `useParams()` in the page component. For nested
sections, use `/profiles/*`, set `sidebar.to` to `/profiles`, set `sidebar.end` to
`false`, and define child `<Routes>` inside that page.

Page titles update the document title, navigation resets content scroll/focus, and
selecting a link closes the mobile drawer. Browser back/forward works normally.
Unknown URLs show a recovery link; page load/render errors keep the app shell
available and offer a retry.

Profiles, Configs, Routing, and Settings use the existing backend models through
`src/app/VpnProvider.tsx` and `src/lib/backend.ts`. Profiles are individual servers;
configs group standalone profiles and subscriptions by their actual source.
The routing canvas, setup management, presets, geo data, and import/export are
ported from the pre-3.0 interface. The tunnel remains Xray TUN.

`ConnectionPage` retains its current sample state and visual implementation.
A standalone Vite preview starts with empty backend data; routing edits in that
preview are local. Run the Wails app for persisted settings and profile actions.

`src/components/Workspace.tsx` provides the compact toolbar, muted icon tiles,
surfaces, selectors, and rows used by Profiles, Configs, Routing, and Settings.
Use these to keep new pages consistent with the connection page's controls.

Run `bun run dev` for development and `bun run build` to check types and build.

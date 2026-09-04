# DockBolt design system

**Kind:** App UI (desktop Docker manager). Not a marketing page.  
**UI copy:** English. Specs and this file: Japanese.  
**Baseline:** 2026-09-04 design review (Vite `http://localhost:1420`). Tokens live in `src/styles.css`.

This is a dense workspace: sidebar, toolbar, virtualized table, status bar. Cards, heroes, feature grids, and decorative motion are out of scope.

## Product chrome

```
┌────────────┬─────────────────────────────┐
│ DockBolt   │ toolbar (Refresh, actions)  │
│ Containers │                             │
│ Compose    │  table  OR  empty state     │
│ Images     │                             │
│ Volumes    │                             │
├────────────┴─────────────────────────────┤
│ status text                    [engine]  │
└──────────────────────────────────────────┘
```

- One primary workspace per route. No dashboard mosaic.
- Current section is the sidebar highlight (`--bg-selected`).
- Logs (`/containers/:id/logs`) must still show where you are (Containers active, or a Back control). Do not leave the nav with no selection.
- No page hero. A quiet toolbar title matching the nav label is allowed (`Containers`, `Images`).

## Color

Use CSS variables. Do not introduce a second palette of one-off hex for the same job.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1c1c1c` | Main workspace |
| `--bg-sidebar` | `#141414` | Sidebar, status bar |
| `--bg-toolbar` | `#1a1a1a` | Toolbar |
| `--bg-row-hover` | `#262626` | Row hover |
| `--bg-selected` | `#2a3f5f` | Selected nav and selected row (cool blue-gray) |
| `--bg-modal` | `#242424` | Dialogs |
| `--fg` | `#e8e8e8` | Primary text (not pure white) |
| `--fg-muted` | `#9a9a9a` | Meta, empty supporting line, column heads |
| `--border` | `#333` | Hairline rules |
| `--accent` | `#3b82f6` | Focus ring, checkboxes. Do not add a third blue |
| `--danger` | `#dc2626` | Destructive confirm only |

Semantic (promote to tokens when touching those rules):

| Role | Value | Use |
|---|---|---|
| Warn | `#f0c14b` | Connecting, disconnected, logs ended |
| OK | `#22c55e` | Running indicator (never color-only; keep a text label) |
| Stderr | `#f87171` | Log stderr lines |
| Control fill | `#2b2b2b` | Buttons, selects, search |

- `color-scheme: dark` on `html`.
- Neutrals stay cool. No purple gradients, no warm/cool mix.
- Danger text on `--danger` currently fails WCAG AA at 12–13px (~3.9:1). Prefer white or a darker red before shipping more `.danger` buttons.
- Selected chrome should converge on one accent story: either desaturate `--accent` into selection, or drop unused `--accent` from marketing-blue leftover.

## Typography

| Role | Size | Weight | Notes |
|---|---|---|---|
| UI body | 13px / 1.4 | 400 | `html` inherits; do not let `html` fall back to Times |
| Brand | 13px | 600 | Sidebar `DockBolt` only |
| Empty title | inherit | 600 | `--fg` |
| Empty support | inherit | 400 | `--fg-muted`, max-width ~28rem, centered |
| Status bar | 12px | 400 | |
| Dialog title | 14px | 600 | |
| IDs, hashes, logs | inherit | 400 | `ui-monospace`, Menlo, Consolas |
| Numeric columns | inherit | 400 | `font-variant-numeric: tabular-nums` |

Stack: `"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`.  
IBM Plex is **named, not bundled**. Until a font file ships with the app, macOS will render Helvetica Neue. Do not go back to `system-ui` / `-apple-system` as the primary face.

This is Activity Monitor density, not a 16px marketing body. Do not jump to Inter/Roboto/Open Sans.

## Spacing and controls

Aim for a 4px rhythm. Current chrome:

| Measure | Value |
|---|---|
| `--sidebar-w` | 168px |
| `--status-h` | 32px |
| Toolbar / logs search / button height | 28px |
| Nav row | ~32–34px |
| Data row | 32px |
| Log row | 22px (denser than resource rows; keep the split) |
| Icon button | 28×28 |
| Dialog | padding 16px, min-width 360px |

- Hairline borders, square tables (no bubbly radius on rows).
- Inputs may use `--radius-control: 2px` later; tables stay square.
- 44px touch targets are not the goal for this desktop tool. Do not shrink below 28px for primary buttons.

## Interaction

- Enabled controls: `cursor: pointer`. Disabled: `opacity: 0.45`, `cursor: not-allowed`.
- Hover: slightly lighter fill (`#333` on controls, `--bg-row-hover` on rows).
- Focus: `outline: 2px solid var(--accent); outline-offset: 2px` on buttons, selects, links, icon buttons, log search. Never `outline: none` without a replacement.
- Selectable table rows must be keyboard-reachable (`role`, `tabIndex`, Enter/Space). Click-only `div` rows are a known gap.
- Destructive:
  - Delete container / volume: confirm dialog + `.danger` on the confirm control.
  - Compose Down and image delete must use the same confirm + danger pattern. Do not one-click delete in the table unless copy and styling say so.
  - Dialog danger is a `variant`, not a string match on the label `"Delete"`.
- Connection line should be `role="status"` / live so connecting is announced.

## Empty, loading, error

Three different states. Do not reuse a blank `VirtualTable` for any of them.

| State | Main pane |
|---|---|
| Connecting | Title “Looking for a Docker engine…” + one line that the list fills when an engine connects |
| Disconnected | Engine message + Retry |
| Connected, no rows | “No containers” / “No images” / “No compose projects” / “No volumes” + a verb (Refresh is already in the toolbar) |
| Loading, no rows | Skeleton rows matching the column grid, or explicit “Loading…”. Not headers over a void |
| Error | Message + next step (Retry when reconnect helps) |

Empty copy is utility English, not “Welcome to DockBolt”.

## Motion

None today. If added: 80–120ms on `background-color` / `opacity` only (hover, modal backdrop). List properties. Honor `prefers-reduced-motion`. No entrance choreography.

## Layout

Desktop-first Tauri (default ~1100×720). No marketing breakpoints.

- Below ~720px, collapse the sidebar to an icon rail or overlay. Do not stack into a mobile landing page.
- Tables may clip horizontally; they must not turn into card lists.

## Anti-patterns

Do not add:

- Purple / indigo gradients, 3-column icon+title cards, emoji chrome
- Centered marketing sections, decorative blobs
- Generic hero copy
- Placeholder-as-label (log search needs a visible label or `aria-label`)
- Color-only status (running dot needs text)

## Known gaps (do not regress the shipped fixes)

Shipped 2026-09-04: connecting empty states, 13px type, 28px controls, amber Connecting, focus-visible, pointer cursors, `color-scheme: dark`.

Still open: page `h1`, logs nav highlight, shared destructive confirm, log search label, tokenizing leftover hex, danger contrast, row keyboard semantics.

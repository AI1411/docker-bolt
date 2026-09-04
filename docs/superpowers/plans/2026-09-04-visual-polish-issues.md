# Visual Polish Issues #8–#15 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land GitHub issues #8 through #15 as sequential PRs merged to `main`, then close tracker #7.

**Architecture:** Extract small, testable chrome helpers (`chromeTone`, `buttonClass`, `statusPill`, `navActive`) and apply CSS tokens so Apple Blue stays CTA/focus only. Each issue is one branch, one PR, merge before the next.

**Tech Stack:** React 18, Vite, Vitest/jsdom, CSS variables in `src/styles.css`, Tauri app shell.

## Global Constraints

- UI copy: English. Do not add marketing heroes, card grids, purple gradients, or Inter as the product face.
- Default branch: `main`. Feature branches: `cursor/<descriptive-name>-52ae`.
- Each issue PR body must include `Fixes #<n>`.
- After each issue: `npm test` and `npm run lint` must pass before PR.
- Do not implement tracker #7 as code; close it after children merge.
- Motion: 80–120ms opacity/background only; honor `prefers-reduced-motion`.

---

### Task 1: Issue #8 unify accent roles

**Files:**
- Create: `src/lib/chromeTone.ts`
- Create: `src/chromeTone.test.ts`
- Modify: `src/styles.css`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/screens/Logs.tsx`

**Interfaces:**
- Produces: `connectionTone(status): "ok" | "warn" | "neutral"`
- Produces: `connectionStatusClass(status): string`
- Produces: `runDotClass(running: boolean): string`

- [ ] Write failing tests for `connectionTone` / `connectionStatusClass` / `runDotClass`
- [ ] Implement helpers and CSS `--ok` `#30d158`, `--warn` `#f5a524`
- [ ] Selection and nav: inset 2px `--accent` bar + `--bg-row-hover` / white 8% fill, not `--bg-selected` blue wash
- [ ] Connecting/disconnected use `--warn`; running dots use `--ok`; `--accent` only CTA/focus
- [ ] Commit, PR, merge `Fixes #8`

---

### Task 2: Issue #9 toolbar hierarchy

**Files:**
- Create: `src/lib/buttonClass.ts`
- Create: `src/buttonClass.test.ts`
- Modify: toolbars in Containers, Compose, Images, Volumes, Logs, StatusBar
- Modify: `src/styles.css` (`.ghost`, `.primary`, `.toolbar-title`)

**Interfaces:**
- Produces: `buttonClass(variant: "primary" | "ghost" | "danger"): string`

- [ ] Default `button` style becomes ghost (outline). `.primary` is Apple Blue pill. `.danger` stays for later token fix in #14 but class exists
- [ ] Each toolbar starts with `.toolbar-title` matching nav label
- [ ] Refresh/Logs/Start/Stop/Clear = ghost; one primary max per bar if needed; Delete/Down = danger
- [ ] Commit, PR, merge `Fixes #9`

---

### Task 3: Issue #10 sidebar brand and active

**Files:**
- Modify: `src/components/icons.tsx` (IconBolt)
- Modify: `src/components/Sidebar.tsx`
- Create: `src/lib/navActive.ts` + `src/navActive.test.ts`
- Modify: `src/styles.css` (`.brand` flex + mark)

**Interfaces:**
- Produces: `containersNavActive(pathname: string): boolean`

- [ ] `/containers/:id/logs` keeps Containers active
- [ ] Brand mark SVG + existing 21px wordmark
- [ ] Optional counts omitted until connected+loaded; skip counts in this issue if stores aren't on Sidebar yet — add counts from container/image/volume/compose store lengths when `view.status === "connected"`
- [ ] Commit, PR, merge `Fixes #10`

---

### Task 4: Issue #11 status pills

**Files:**
- Create: `src/components/StatusPill.tsx`
- Create: `src/lib/statusPill.ts` + tests
- Modify: Containers, Compose, Logs, StatusBar, `src/styles.css`

**Interfaces:**
- Produces: `resourceStatusPill(state: string, running?: boolean): { label: string; tone: "ok" | "neutral" | "warn" }`
- Produces: `connectionPill(status): { label: string; tone }`

- [ ] Pill = 6px dot + label, never color-only
- [ ] Status bar left is a pill; engine name stays in the select
- [ ] Connecting pulse 100ms opacity unless `prefers-reduced-motion`
- [ ] Commit, PR, merge `Fixes #11`

---

### Task 5: Issue #12 quieter data surface

**Files:**
- Modify: `src/styles.css` (`.row` border, `.row.section` hairline, `tabular-nums` on numeric cells)

- [ ] Data rows: no `border-bottom`. Section rows keep a hairline. Header rule stays on `.vtable-head`
- [ ] Commit, PR, merge `Fixes #12`

---

### Task 6: Issue #13 fonts

**Files:**
- Add `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`
- Modify: `src/main.tsx` imports
- Modify: `src/styles.css` stacks + letter-spacing
- Modify: `DESIGN.md` app-font note

- [ ] Ship Plex as the guaranteed face; keep SF Pro names first only if they remain as optional system fonts after Plex — actually put Plex first so Linux/Windows match
- [ ] `.mono` uses Plex Mono
- [ ] `letter-spacing: normal` on the shipped face (do not keep -0.357px on Plex)
- [ ] Commit, PR, merge `Fixes #13`

---

### Task 7: Issue #14 button variants and modal / danger

**Files:**
- Modify: `src/components/ConfirmDialog.tsx` + test
- Modify: call sites to pass `confirmVariant`
- Modify: `src/styles.css` `--danger: #ff453a` (or darker red that AA-passes white text)

**Interfaces:**
- Produces: `ConfirmDialog` `confirmVariant?: "primary" | "danger"` — never infer from `confirmLabel === "Delete"`

- [ ] Down and Delete use `confirmVariant="danger"`
- [ ] OK/error dialogs use primary or ghost
- [ ] Commit, PR, merge `Fixes #14`

---

### Task 8: Issue #15 Logs terminal surface

**Files:**
- Modify: `src/screens/Logs.tsx`
- Modify: `src/styles.css` (`.logs-pane`, stderr tint, timestamp muted)

- [ ] Search `aria-label="Search logs"`
- [ ] stderr: `--stderr` text + row background, not accent-bright
- [ ] Running label next to dot
- [ ] Commit, PR, merge `Fixes #15`

---

### Task 9: Close tracker #7

- [ ] Comment/close #7 after #8–#15 are merged

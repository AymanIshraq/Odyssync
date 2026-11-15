# Odyssync UI design handoff

## Read this first

Read the current `plan/contract.md` in the Odyssync repository before every response and before implementation. It owns message names, field names, units, renderer methods and track boundaries. Also read the repository's applicable instructions and the plan for the track being changed.

Contract: https://github.com/mahi-makarim/Odyssync/blob/main/plan/contract.md
Original visual reference: https://www.figma.com/make/LKWxepxo23KQfbM1L572pl/AI-Resistant-Design-Review
Repository: https://github.com/mahi-makarim/Odyssync

This document transfers design decisions and local UI work into the user's VS Code Codex session. No GitHub files were changed. The user wants to work in the local clone from VS Code.

The approved visual baseline is the original Figma Make design, restored following the user's request to return to the original project. Keep the navy, cobalt, orange and lime appearance. Do not bring back parchment surfaces, serif display typography, ships, compasses or nautical copy.

The browser prototype is named DeskMash. The destination repository is named Odyssync. These screenshots record the prototype's existing wordmark; use Odyssync as the destination application's name when integrating. Do not infer that the prototype already implements Odyssync's native behavior.

## Current task and implementation status

The user wants UI 2 implemented one step at a time. The immediate task is only the moving-box overlay spike in `tools/spikes/overlay/`, described in `plan/ui2-overlay.md` under "Hour 16 to 15: spike".

The spike has not been implemented in this chat. Neither have the ghost lifecycle, bezel glow, native approval card, voice indicator or file-drop overlay. The browser prototype and its screenshots are control-centre design references, not proof of an operational Electron overlay.

Start by inspecting the cloned repo. Files or directories listed in the plan may not exist yet. Keep the spike self-contained so it can be tested without replacing the shared main process. Changes needed in shared `app/main/index.js` belong to coordination with the owner of that track.

Do not build the later UI 2 items until the user asks to continue.

## Reference images and their origin

All paths below are relative to this `design.md` file.

| File | Content | Origin |
| --- | --- | --- |
| `images/00-original-figma-reference.jpg` | Original landing page, with Figma's surrounding header | Screenshot of the supplied Figma Make URL |
| `images/01-landing-dark.jpg` | Current dark landing page | Local restored browser prototype |
| `images/02-landing-light.jpg` | Current light landing page | Local restored browser prototype |
| `images/03-create-workspace.jpg` | Create-workspace dialog | Local restored browser prototype |
| `images/04-workspace-dark.jpg` | Workspace, modes and activity, including visible exit | Local restored browser prototype |
| `images/05-sharing-permissions.jpg` | Sharing choices dialog | Local restored browser prototype |
| `images/06-people-requests-resolved.jpg` | Joining 0 and resolved join-request state | Local restored browser prototype |
| `images/07-rename-workspace.jpg` | Rename dialog | Local restored browser prototype |
| `images/08-workspace-phone.jpg` | Full phone workspace with visible exit and separate Allow/Decline actions | Local restored browser prototype |
| `images/09-landing-phone.jpg` | Full phone landing page | Local restored browser prototype |

These are reference screenshots, not editable Figma frames or native Figma exports. The original ZIP contains only one standalone raster asset, `public/favicon.png`. Its laptops, overlapping logo marks, backgrounds and icons are drawn in React/CSS/SVG. Their editable implementations are in `source-reference/`.

### Asset files

- `assets/original-favicon.png`: copied unchanged from the original supplied ZIP.
- `assets/app-icons/`: install icons generated locally for the later web-app shell. They are not original Figma assets.
- `source-reference/App.tsx`: current browser UI, including Logo, LaptopArt, Icon and ParticleField definitions.
- `source-reference/index.css`: current visual rules and responsive adjustments.
- `source-reference/useLocalPreference.ts`: browser preference helper.
- `source-reference/components/InstallApp.tsx`: browser installation guidance and prompt handling.

`source-reference/` is a reference snapshot, not a standalone runnable app. Do not copy its App.tsx over the Electron main process or treat it as an overlay renderer. The previously delivered `DeskMash-cross-platform.zip` contains the runnable web project. The stylesheet in this handoff also includes two subsequent layout corrections described below.

## Visual system

### Colors used by the restored source

| Role | Value |
| --- | --- |
| Dark page background | `#061630` |
| Dark application surface | `#07172f` |
| Dark header | `rgba(8,24,49,.93)` |
| Dark internal divider | `#243855` |
| Primary light text | `#f2f6ff` |
| Secondary dark-theme text | `#a6b5cb` |
| Cobalt | `#155cf4` |
| Tangerine | `#ff7618` |
| Lime primary action in dark theme | `#c9fa19` |
| Light application surface | `#fbfaf8` |
| Light text/ink | `#111827` |

Match the selected states to the source: lime for the dark landing page's create action, cobalt for selected modes and approval actions, orange for pending or incoming accents. Avoid applying every accent to every component.

The large orange and lime background shapes belong to the control-centre/landing presentation. A native overlay must stay transparent; do not put these backgrounds on it.

### Type

- Manrope is the primary UI face; retain a system sans-serif fallback.
- DM Mono is for section numbers, room codes and small metadata.
- The original desktop hero uses large sans-serif type with tight tracking.
- Phone inputs use at least 16px text to avoid input zoom on iOS.
- Keep interactive text readable. Several original desktop metadata labels are small; use the source and screenshots for proportions, then validate actual readability in the target Electron window.
- Use plain sentence-case copy. Avoid slogans in operational panels and never claim a physical connection from demo state.

### Shape and spacing

- Desktop landing shell: up to 1180px wide, about 20px corner radius, thin border.
- Desktop workspace: up to 1260px wide.
- Desktop header: approximately 66px high.
- Primary buttons: approximately 52px high, with clear hover and focus states.
- Use the source stylesheet for exact spacing, shadows and illustration geometry.
- Keep device illustrations as code-drawn objects; do not flatten the entire interface into screenshot backgrounds.

## Screen structure

### Front page

The header contains the logo and theme control. The main content pairs the tagline "Your screens. One shared space." with three connected laptop illustrations. Create and Join actions sit below the description. A subtle particle field runs behind the shell.

The current prototype adds an Install app action and identifies itself as a demo. Desktop window-decoration marks are decorative and hidden on phones or standalone installation.

### Workspace

The header contains logo, workspace name, room-code copy action and theme control. The user explicitly removed Settings, Notifications and the Connected label from this header.

The body contains People requests and Sharing permissions, device representations, incoming-share mode selection, recent activity, and exit. Keep the exit action visible in normal layout flow.

The incoming request shows sender, title, Allow and Decline, plus dismissal. On phones, Allow and Decline occupy distinct rows rather than covering one another.

### Dialogs

Create, Join, Rename, People requests and Sharing permissions use the same modal treatment. Include keyboard focus containment, Escape to close, a visible close action and viewport-limited scrolling. On phones, allow enough room for the on-screen keyboard and safe areas.

## User-requested behavior already implemented in the reference UI

1. Exit returns to the front page.
2. The Leaving tab opens a useful empty state: no pending leave requests.
3. Approving or declining Mika removes the join row and sets Joining to 0.
4. Settings and notification icons are removed from the workspace header.
5. The Connected header indicator is removed.
6. Copy actually copies the six-digit demo room code; denied clipboard access produces a fallback message.
7. Arrange layout toggles the prototype between grid and list.
8. View all expands the activity area's explanatory state.
9. Saving permission choices retains them when the panel is reopened.
10. Clicking the workspace name opens Rename; blank names are disallowed and Cancel preserves the name.
11. The restored web prototype has responsive iOS/Android/Windows browser layouts and a PWA shell.

The local prototype persists theme, room name, mode, layout, join-request result and permission choices in browser storage. That is demo persistence, not shared room state.

Two additional corrections were made while preparing this handoff: exit is in normal workspace flow rather than absolutely positioned below it, and mobile incoming Allow/Decline buttons have separate grid rows. The screenshot and reference stylesheet reflect those fixes.

## Integration boundaries: follow contract.md

The repository separates `app/control/` from `app/overlay/`. The screenshots above primarily inform `app/control/`. Do not make the transparent overlay into a dashboard.

The current Renderer API lists these control methods:

- `createRoom(displayName)`
- `joinRoom({roomNumber, pin, displayName, directIp?})`
- `leaveRoom()`
- `setLayout(screens)`
- `setMode(mode)`
- `kick(deviceId)`
- `sendDirect(deviceId)` (marked later in the contract)
- `onState(cb)` and `onNotice(cb)`

Room number and PIN are separate contract fields. The prototype's single demo room-code input is not the complete production join form.

The contract does not currently specify a workspace rename method or a general sharing-permissions setter. Keep those prototype interactions distinct from working bridge integration. Do not invent renderer APIs for them. Identify the gap for the relevant track owner before wiring them to real room state.

The actual contract has three modes: `collaborative`, `approval`, `focus`. Do not import Queue mode from the abandoned redesign into this integration.

Sample device names and sample activity are demonstration data. Real state must come from `onState`; real notices must come from `onNotice`.

## UI 2: immediate moving-box spike

Create a fullscreen transparent Electron window and draw one moving box. The requested native flags are:

```js
{
  transparent: true,
  frame: false,
  fullscreen: true,
  skipTaskbar: true,
  focusable: false
}

window.setAlwaysOnTop(true, 'screen-saver');
window.setIgnoreMouseEvents(true, { forward: true });
```

Use one requestAnimationFrame loop and transform-based movement. Provide a measured FPS display and a reliable stop command or shortcut because the overlay cannot receive focus. Keep the rest of the document transparent. Do not multiply renderer geometry by devicePixelRatio.

A browser page can demonstrate motion but cannot prove desktop click-through, taskbar stacking or native focus behavior. Those checks require the Electron spike running on the actual desktop.

| Check | Passing evidence | Current status |
| --- | --- | --- |
| Click-through | Click Chrome and Explorer controls while the box passes over them | Not tested; spike not implemented here |
| Scrolling | Scroll the underlying Chrome and Explorer windows normally | Not tested |
| Typing | Type in an underlying focused text field without the overlay stealing focus | Not tested |
| Taskbar stacking | Observe the moving box over the taskbar | Not tested |
| Motion | Measure approximately 60 fps on a 60Hz display and note missed frames | Not tested |
| Different display scaling | Run checks on two laptops with different scaling | Not tested |

Do not report these as passing based on a screenshot or the presence of window flags.

## Later overlay work: reference only

After the user authorizes the next item, follow the live `plan/ui2-overlay.md` and `contract.md`.

- Renderer events arrive through `odyssync.onEvent(cb)`.
- Renderer edges are uppercase LEFT, RIGHT, TOP, BOTTOM and already refer to this screen's edge. Do not flip them again. The network section's sender-edge rule is not the renderer's rule.
- All renderer geometry is DIPs. Ratios along an edge are 0..1.
- Each ghost is keyed by transferId; support simultaneous transfers.
- PREVIEW preloads imageUrl. Receiver DRAG_MOVE uses width, height, protrusionPx and centerRatio, clamped to the screen.
- CANCEL slides out in 160ms.
- Receiver COMMIT settles over 260ms with cubic-bezier(0.16,1,0.3,1), blur 4px to 0, then calls ghostSettled(transferId, rect).
- PLACED fades out in 120ms. FAILED/REJECTED return the ghost outward.
- Sender COMMIT sends the ghost off-screen in 160ms; failure/rejection recoils.
- Bezel feedback is 14 by 300 DIPs and follows centerRatio, colored by mode.
- BOUNCE uses the specified 80ms squash and 340ms rebound.
- Approval COMMIT docks 90 DIPs inward and shows sender, title, shortened URL and 340 by 140 approval controls.
- Only the approval hit area requests interactivity through setInteractive(bool). Buttons call answer(transferId, accepted).
- VOICE states are idle, listening, thinking and speaking.
- Direct COMMIT can arrive without PREVIEW or DRAG_MOVE; handle missing prior state safely.

The current contract does not define an overlay renderer file-drop-to-main method or member-target list event. Do not invent their bridge names. Treat those as integration questions for the main/preload owner when that item is reached.

## Responsive and accessibility requirements

Preserve keyboard operation, visible focus, meaningful control names and modal focus containment. Respect prefers-reduced-motion and provide a pause mechanism for continuing decorative motion. Keep core actions at least 44px on touch devices. Avoid horizontal overflow and test safe areas, landscape, dialogs and keyboard opening.

The native transparent Electron overlay is a desktop feature. The browser PWA work does not make a system-level overlay available on iOS or Android.

## Writing and visual constraints

Use direct copy describing the action or state. Avoid invented labels, repeated dramatic fragments, unsupported claims, decorative statistics and generic AI marketing language. Do not add fake testimonials or usage numbers.

Keep the restored original design unless the user explicitly requests another redesign. The prior Odyssey visuals and their code are superseded.

## Start prompt for Codex in VS Code

```text
Read plan/contract.md before every response. Read design.md,
plan/ui2-overlay.md, and applicable repository instructions.
The images are control-centre design references; source-reference
contains an earlier browser prototype.

Implement only the moving-box spike in tools/spikes/overlay/.
Use the specified transparent, frameless, fullscreen,
non-focusable, always-on-top, mouse-through Electron window.
Draw one moving box using transform and a single rAF loop.
Include FPS measurement and a reliable way to stop it.
Keep shared track files unchanged while building this spike.

Create runnable code, run the available checks, and give me
the exact launch command. State which desktop checks need my
manual verification. Leave the changes local for review.
Do not implement later overlay items yet.
```

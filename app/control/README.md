# Control Center — Item 1

Dependency-free Electron renderer: HTML, CSS, and JavaScript. Includes the requested incoming-share mode selector. Roster, kick controls, and direct sending are not included.

The visual direction comes from `design-reference/design-reference/design.md`, its ten screenshots, and `source-reference/App.tsx` / `index.css`. The navy shell, cobalt/orange logo, lime actions, background shapes, and original CSS laptop geometry are adapted for Odyssync. Typography uses Inter throughout, including room codes, inputs, and metadata. Weights 400–800 are bundled in assets with the OFL license; no font requests are made at runtime. The earlier Manrope/DM Mono files are retained but no longer loaded. The original favicon is reused. PWA install icons and installation flows belong to the browser prototype and are not needed in this Electron renderer.

Item 1's contract takes precedence over prototype behavior: the create dialog edits a display name rather than an unsupported workspace name; Join has separate room-number and PIN fields plus direct IP; the workspace uses a draggable layout rather than independent device tiles. Theme is a local visual preference only. Rename, activity, and sending are outside this implementation.

Join requests and Sharing permissions are interactive in the preview: host-only approval policy, approve/decline actions, and per-person sharing switches. Open Join requests and use Demo: reconnect a laptop to try the pending-approval flow. Declined requests stay out of the room; approved laptops appear on the canvas. Permissions persist across closing and reopening the dialog. The optional bridge extension and outstanding native enforcement work are documented in MANAGEMENT-INTEGRATION.md. No native room backend exists in this checkout. The plan and memory-bank files remain unchanged.

## Preview

From the repository root run `python -m http.server 8000`, then open `http://localhost:8000/app/control/preview.html` in Chrome.

The preview is explicitly fake: it cannot connect laptops. Click Create a Room, confirm the display name, and submit to open a four-screen host room. Join uses room **482916**, PIN **1234**; direct IP accepts any nonempty address with that PIN. Other PINs show `bad_pin` without leaving the form. Append `?scene=room`, `?scene=create`, `?scene=requests`, `?scene=permissions`, or `?scene=join` to preview those states directly.

## Integration with Tech 2

Load `app/control/index.html` in the Control Center BrowserWindow using the existing planned `main/preload-control.js`. The preload must expose `window.odyssync` from `plan/contract.md`. Production never loads the preview API.

Send the initial `onState` snapshot before the user creates or joins, with `self.profile.displayName` set to the machine name. The renderer cannot access the OS hostname through a sandboxed browser; Tech 2 must supply it. Both `self.deviceId` and a string `self` ID are accepted, but the display-name default needs the profile object. Emit full state snapshots on join, leave, and layout changes. Member names come from `members[].profile.displayName`; rectangles use `{ deviceId, x, y, w, h }` in DIPs without adding UI-only fields.

The renderer calls only createRoom, joinRoom, leaveRoom, setLayout, setMode, onState, and onNotice. Room authority, membership timing, neighbor calculation, offline networking, and room shutdown remain in Tech 2's implementation. API failures should reject promises or return the documented join `{ ok, reason }`. Names and notices are rendered as text, never interpreted as HTML.

## Checks

The dragged tile follows the pointer using a composited transform, updated at most once per animation frame without rebuilding the canvas. Other tiles stay fixed; hovering highlights the target and releasing exchanges only the two exact positions. Dropping into empty space snaps to the nearest free edge, allowing rows, columns, and grids. Keyboard movement previews the swap target without moving the cards until Enter.

Open `http://localhost:8000/app/control/tests.html` for browser-based automated checks. These cover layout geometry and preview UI flows. To manually check pointer input, create a room, swap the first and fourth laptops. Drop laptops above and below the row and confirm they snap edge to edge into a grid. Resize the window and check that cards remain visible. Keyboard: focus a laptop, use arrow keys to choose a position, Enter to swap, Escape to cancel.

Or run `python app/control/check_browser.py --screenshots` from the repository root. This starts a temporary localhost server, runs installed Chrome headlessly, prints the results, and saves screenshots in a temporary review directory. It includes actual 390px iframe previews because headless Chrome clamps small native window sizes. No external Python packages are required. Create and Join use native modal focus containment, Escape closes them, and focus returns to the opening button. The background is static, and reduced-motion preferences disable transitions.

In the preview console, `previewControls.asMember()` changes to read-only; `previewControls.removeLast()` simulates a departure; `previewControls.notice('room_closed', 'The host ended the room.')` returns to launch with a notice. Use `kicked` to check the same behavior for removal.

Four-laptop acceptance checks E1.1-E1.5 and E2.1-E2.3 still require the real preload and backend. Do not treat the preview as evidence of network operation or the three-second membership requirement.


The incoming-share selector was added at the user's request. It uses native radio inputs for Focus, Collaborative, and Approval, with a faint gradient instead of tiles. The selected value comes from modes[self.deviceId]; changes call the contracted setMode method and failed calls restore the previous selection. The preview simulates mode state only; actual transfer enforcement remains in the backend and overlay.

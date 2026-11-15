# Odyssync — Contract between tracks

Frozen in the first hour. Any change is announced to all four people.
This file is the single source for message names and fields.

## Folder layout

```
app/
  package.json
  main/
    index.js            # Electron entry, creates both windows        (Tech 2)
    transport.js        # TransportManager                            (Tech 2)
    room.js             # room state, layout, neighbours, handoff FSM (Tech 2)
    sidecar-bridge.js   # ws server on 127.0.0.1:8089, spawns sidecar (Tech 2)
    preload-control.js  # exposes window.odyssync to Control Center   (Tech 2)
    preload-overlay.js  # exposes window.odyssync to the overlay      (Tech 2)
    preload-voice.js    # exposes window.odyssync.voice               (voice owner)
  server/
    server.js           # standalone room server: cloud AND embedded  (Tech 2)
  control/              # Control Center renderer                     (UI 1)
  overlay/              # overlay renderer                            (UI 2)
  voice/                # hidden voice window                         (voice owner)
  config.json           # relay URL, ElevenLabs agent ID, Picovoice key
sidecar/
  win32_daemon.py       #                                             (Tech 1)
  requirements.txt
tools/
  replay.js             # replays recorded messages into the overlay  (Tech 2, first hour)
  spikes/               # throwaway
```

## IDs and units

- `deviceId`: 8 hex chars, generated at app start.
- `transferId`: UUID, created by the sender when a drag enters an edge zone.
- `mode`: `"collaborative" | "approval" | "focus"`.
- `edge`: `"LEFT" | "RIGHT" | "TOP" | "BOTTOM"`, always **the sender's edge**.
  The receiver draws on the opposite edge.
- **Sidecar speaks physical pixels. Everything on the network and in the
  renderers is DIPs.** `main/room.js` converts with the machine's `dpiScale`.
- Positions along an edge are ratios 0..1. Sizes are DIPs.

## Envelope (every JSON message between laptops)

```json
{ "type": "...", "fromId": "a1b2c3d4", "toId": "e5f6a7b8", "mid": 123 }
```

`toId` is a `deviceId`, or `"*"` for everyone in the room. `mid` is a counter
per sender; receivers drop a `(fromId, mid)` they have already seen.

## Binary frames (network and sidecar loopback)

`[uint32 LE header length][UTF-8 JSON header][payload bytes]`
The header carries the same envelope fields.

## Room server (`server.js`): the same code in the cloud and in the host

The server is a simple router. It keeps `rooms[roomNumber] = { pin, hostId,
members }`, checks the PIN, forwards by `toId`, and announces joins and leaves.
Layout and modes are owned by the host's app, not by the server.

| Message | Direction | Fields |
|---|---|---|
| `CREATE_ROOM` | host → server | `roomNumber, pin, hostLocalIps[], localPort, profile` |
| `ROOM_CREATED` / `ROOM_ERROR` | server → host | `reason?` |
| `JOIN_ROOM` | client → server | `roomNumber, pin, profile` |
| `JOIN_ACCEPTED` | server → client | `hostId, members[], hostLocalIps[], localPort` |
| `JOIN_REJECTED` | server → client | `reason: "bad_pin" | "no_room" | "full"` |
| `MEMBER_JOINED` | server → `*` | `member` |
| `MEMBER_LEFT` | server → `*` | `deviceId, reason: "left" | "kicked" | "lost"` |
| `ROOM_CLOSED` | server → `*` | sent when the host's socket closes |
| `KICK_MEMBER` | host → server | `targetDeviceId` |
| `PING` / `PONG` | both | `t` |

`profile = { displayName, screenWidth, screenHeight, dpiScale }` (DIPs).
`member = { deviceId, profile }`.
On the embedded server `roomNumber` is ignored and only the PIN is checked.
A laptop that wins the local race sends the same `JOIN_ROOM` on the local socket.

Who is in the room, when two servers both report it (rules for `main/room.js`):
- A member is in the room while they are reachable on either path.
- `MEMBER_LEFT` from one server removes a member only if they are not on the
  other path as well.
- `ROOM_CLOSED` from the relay is ignored while the local socket to the host is open.
- Known limits: if the host loses internet, remote members are dropped and
  local ones carry on. A laptop that joined by direct IP is invisible to
  remote members; direct IP is for when there is no internet.

## Two paths, no bridging

Every laptop keeps its cloud socket open and adds a local socket if the 500 ms
race succeeds. The embedded server tells its clients who else is on it:

| `LOCAL_PEERS` | embedded server → its clients | `deviceIds[]` |

`TransportManager.sendToPeer(id, msg)`: use the local socket if it is open and
`id` is in `LOCAL_PEERS`; otherwise the cloud socket. `"*"` goes out on every
open socket and is de-duplicated by `mid`. (This replaces "the host bridges"
in the spec: same result, less code.)

## Room state (host → `*`)

| Message | Fields |
|---|---|
| `LAYOUT_UPDATED` | `screens: [{deviceId, x, y, w, h}]`, `neighbors: { [deviceId]: {left, right, top, bottom} }` |
| `MODE_UPDATED` | `deviceId, mode` (sent by the laptop whose mode changed; part of Tech 2's item 1, because the sender rules need it) |
| `ROOM_STATE` | `screens, neighbors, modes: { [deviceId]: mode }` (host → a newly joined member) |

## Handoff (sender → receiver)

| Message | Fields |
|---|---|
| `WINDOW_PREVIEW_FRAME` (binary) | header `transferId, mime, width, height`; payload JPEG |
| `EDGE_DRAG_MOVE` | `transferId, edge, protrusionPx, centerRatio, width, height` |
| `EDGE_DRAG_CANCEL` | `transferId` |
| `TRANSFER_COMMIT` | `transferId, kind: "tab" | "file", edge, centerRatio, width, height, url?, title?, browser?, filename?, size?, direct?: boolean, open?: boolean, app?: string` |
| `FILE_PAYLOAD` (binary) | header `transferId, filename, mimeType, size`; payload bytes; max 50 MB |

Receiver → sender:

| `TRANSFER_ACCEPTED` | `transferId` |
| `TRANSFER_REJECTED` | `transferId, reason: "focus" | "rejected" | "timeout"` |
| `TRANSFER_FAILED` | `transferId, error` |

`browser` is `"chrome" | "msedge" | "brave"`. `EDGE_DRAG_MOVE` is sent at most
once per 16 ms; if the socket is backed up, only the newest is sent.

### Sender rules (in `main/room.js`)

1. Drag enters an edge that has a neighbour → new `transferId`, forward preview and moves.
2. Release with the cursor **not** at the edge → `EDGE_DRAG_CANCEL`.
3. Release at the edge, receiver in `focus` → `BOUNCE_WINDOW`, nothing sent but a cancel.
4. Release at the edge otherwise → `HIDE_WINDOW`, send `TRANSFER_COMMIT`.
5. `TRANSFER_ACCEPTED` → `CLOSE_WINDOW`.
6. `TRANSFER_REJECTED`, `TRANSFER_FAILED`, or no answer in 5 s (35 s if the
   receiver is in `approval`) → `SHOW_WINDOW`.

### Receiver rules

1. `collaborative`: `OPEN_URL` at the ghost's position; on `WINDOW_PLACED`
   fade the ghost and send `TRANSFER_ACCEPTED`; on `OPEN_FAILED` send `TRANSFER_FAILED`.
2. `approval`: dock the ghost; Accept → as above; Reject or 30 s → `TRANSFER_REJECTED`.
3. `focus`: reply `TRANSFER_REJECTED {reason: "focus"}` (safety net; the sender should not have sent).

## Sidecar loopback (`ws://127.0.0.1:8089`, the sidecar connects to Electron)

All coordinates here are **physical pixels**.

Sidecar → Electron:

| Message | Fields |
|---|---|
| `SIDECAR_READY` | `screenWidth, screenHeight, dpiScale` |
| `LOCAL_DRAG_START` | Browser: `hwnd, browser, url, title, tabCount` (only when `tabCount == 1` and a URL was read). Document variant below. |
| `LOCAL_WINDOW_PREVIEW` (binary) | header `hwnd, mime, width, height` |
| `LOCAL_DRAG_MOVE` | `hwnd, edge, protrusionPx, centerRatio, width, height, cursorX, cursorY, cursorAtEdge` (`edge` is null outside the 120 px zones) |
| `LOCAL_DRAG_END` | `hwnd, edge, cursorAtEdge, velocity` |
| `WINDOW_PLACED` | `transferId, hwnd` |
| `OPEN_FAILED` | `transferId, error` |
| `LOCAL_FILE_DRAG` | `active, edge` (Explorer drag near an active edge) |

Electron → sidecar:

| Message | Fields |
|---|---|
| `SET_ACTIVE_EDGES` | `left, right, top, bottom` (booleans; sent on every layout change) |
| `HIDE_WINDOW` / `SHOW_WINDOW` / `CLOSE_WINDOW` | `hwnd` |
| `BOUNCE_WINDOW` | `hwnd, edge` |
| `OPEN_URL` | `transferId, url, browser, x, y, width, height` |
| `OPEN_FILE` | `transferId, path, app?, expiresAt?, x, y, width, height` (document extension below) |

`cursorAtEdge` is true when the cursor is within 4 px of the screen edge.

### Document-window extension (integration branch)

This records the document flow already introduced on integration and its Windows
fixes. Browser messages, renderer APIs, coordinate units and file-drop behavior
are unchanged. A document still uses `kind: "file"` and `FILE_PAYLOAD` on the network.

- A successful document `LOCAL_DRAG_START` carries `hwnd, kind: "document",
  path, title, app, keepSource?`. `path` is local only and never sent to peers.
  `keepSource: true` prevents closing other tabs in a Notepad window. Code editors
  also retain their project window; only the active saved file is copied.
- A supported application that cannot supply its document sends the same local
  start with `kind: "document", hwnd, error` instead of a path. Electron shows
  that error only on an attempted drop at an occupied edge. No preview, file or
  window command is sent for that failed lookup.
- Notepad supplies a temporary UTF-8/CRLF plain-text snapshot of its complete
  active document, including unsaved text. Word/Excel/PowerPoint require a saved
  local document with no pending edits. VS Code/Cursor require the one-time
  `window.title` setting in `sidecar/README.md` and a saved active file.
- For a document, `TRANSFER_COMMIT` includes `open: true` and optionally `app`.
  The receiver saves a unique filename in `Downloads/Odyssync`, then opens it.
  Recognized app values: `notepad.exe`, `winword.exe`, `excel.exe`, `powerpnt.exe`,
  `code.exe`, `cursor.exe`. Unknown app values cannot select an executable.
  Office launches are restricted to ordinary supported document extensions;
  executable/script files may only be displayed in a supported text editor.
- `OPEN_FILE.path` is the receiver's saved path. Its coordinates are physical
  pixels. `expiresAt` is an optional receiver-generated Unix timestamp in
  milliseconds; queued commands that have expired must not launch an app.
  It reports `WINDOW_PLACED` or `OPEN_FAILED`, just like `OPEN_URL`.
- Document startup gets 20 seconds; the sender allows 90 seconds for payload,
  animation and startup, or 120 seconds in Approval mode. A missing application
  leaves the received copy in Downloads, reports failure and restores the source
  window. Saving alone does not count as a successful document auto-open.
- A released drag can wait up to 2 seconds for its outstanding native lookup.
  It retains the exact release coordinates; another click or focus change
  cancels this deferred release. Stale results never start another drag.

For the voice assistant (request, then reply):

| `GET_ACTIVE_TAB` → `ACTIVE_TAB` | reply `hwnd, browser, url, title, tabCount`, or `error` |
| `GET_SELECTED_FILE` → `SELECTED_FILE` | reply `path, name, size`, or `error` |

## Renderer API (`window.odyssync`, provided by the preloads)

Control Center:
```
odyssync.createRoom(displayName)            -> { roomNumber, pin, localIps }
odyssync.joinRoom({ roomNumber, pin, displayName, directIp? }) -> { ok, reason? }
odyssync.leaveRoom()
odyssync.setLayout(screens)                 // host only
odyssync.setMode(mode)
odyssync.kick(deviceId)                     // host only
odyssync.sendDirect(deviceId)               // later; sends the last active browser tab, same path as the voice tool
odyssync.onState(cb)   // cb({ self, isHost, roomNumber, pin, localIps, members,
                       //      screens, neighbors, modes, transports, pings })
odyssync.onNotice(cb)  // cb({ kind: "kicked" | "room_closed" | "error", text })
```

Overlay:
```
odyssync.onEvent(cb)            // cb(event), see below
odyssync.setInteractive(bool)   // turn click-through off/on for the Approval card
odyssync.answer(transferId, accepted)
odyssync.ghostSettled(transferId, rect) // overlay tells main where the ghost ended
```

Overlay events all carry `role: "sender" | "receiver"`, `edge` already flipped
to **this screen's** edge, and DIP coordinates:
`PREVIEW {transferId, imageUrl}`, `DRAG_MOVE {transferId, protrusionPx,
centerRatio, width, height, mode}`, `CANCEL`, `COMMIT {transferId, kind, title,
url, filename, size, fromName, mode, direct}` (`mode` is this laptop's own mode), `PLACED`, `BOUNCE`, `REJECTED`, `FAILED`.

Voice window (`window.odyssync.voice`), each returning the tool result in `voice.md`:
```
odyssync.voice.listMembers()
odyssync.voice.sendCurrentTab(targetName)
odyssync.voice.sendSelectedFile(targetName)
odyssync.voice.setMode(mode)
odyssync.voice.setState(state)   // "idle" | "listening" | "thinking" | "speaking"
odyssync.voice.onStart(cb)       // hotkey pressed
```
The overlay also receives `VOICE {state}`. A `COMMIT` with `direct: true`
arrives with no `PREVIEW` or `DRAG_MOVE` before it.

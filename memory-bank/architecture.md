# Odyssync — Architecture

Status: APPROVED by the user 2026-11-14. Task lists are in `plan/`.
Read `project-brief.md` first. Scope tiers referenced here are defined there.

## 1. Shape

Every laptop runs the same app, made of two processes (Electron and the
Python sidecar):

```
+--------------------------- one laptop ---------------------------+
|  Electron main                                                   |
|   - Room client (sockets to the cloud relay and to the host)     |
|   - Room host (WebSocket server :8080)  <- only on the host      |
|   - Sidecar bridge (WebSocket server 127.0.0.1:8089)             |
|   - Browser launcher requests -> sidecar                         |
|        |                         |                               |
|  Control Center window     Overlay window        Voice window    |
|  (launch, canvas, modes)   (fullscreen, see-     (hidden: mic,   |
|                             through, on top)      ElevenLabs)    |
|                                                                  |
|  Python sidecar (sidecar/win32_daemon.py), spawned by Electron   |
|   - 60 Hz mouse + foreground-window poll                         |
|   - tab-drag detection, URL read, window snapshot                |
|   - close / move / place native windows                          |
+------------------------------------------------------------------+
```

Network: two paths, one codebase (spec section 4). The same `server.js` runs
in the cloud (the relay: room directory, PIN check, forwarding) and inside the
host's Electron process (`:8080`).

- Every laptop connects to the cloud relay to find and join the room.
- It then tries the host's local addresses for 500 ms. If one answers, the
  local socket becomes the active path; if not, it stays on the relay.
- Every laptop keeps its relay socket open. A message goes over the local
  socket when the target is also on it, and over the relay otherwise, so a
  laptop on the hotspot and one in another city are in the same room. (The
  spec has the host bridge the two; this gives the same result with less
  code. Planner's call.)
- If the local socket drops, the laptop falls back to the relay without
  leaving the room. If the internet drops, laptops on the hotspot carry on,
  and new ones can join by host IP + PIN.
- If the host leaves, the room ends.

Remote peers get the same features. Drag streaming over the internet is
coalesced to the latest frame, so the ghost may trail the drag but never
queues up.

## 2. Approaches considered

**Windows layer**
- Python sidecar (chosen by the user): fastest to write, proven libraries
  (`pywin32`, `uiautomation`, `Pillow`, `mss`). Costs a second runtime.
- Node only via FFI: one runtime, but reading the address bar through UI
  Automation from Node is the riskiest step made harder.
- All-Python app: dropped, the overlay animations are what Electron makes easy.

**When the receiver opens the real tab**
- On release (chosen by the user): snapshot covers the browser start-up wait.
- Pre-open during the drag: instant arrival, but steals focus from the
  receiver's typing and leaves windows to clean up on cancelled drags. Kept as
  a possible later upgrade if the wait feels long.

**Networking**
- Cloud relay plus host-embedded server with automatic local upgrade (the
  spec's design; chosen by the user, who wants remote collaboration built).
- Host-embedded server only, join by IP + PIN: kept as the offline fallback.
- UDP broadcast lookup: already ruled out by the spec.

## 3. Components

| Component | Lives in | Responsibility |
|---|---|---|
| Room host | Electron main | Auth by PIN, member list, layout, neighbour map, message forwarding |
| Room client / `TransportManager` | Electron main | `sendToPeer(id, json)`, `sendBinaryToPeer(id, header, buffer)`; picks the local or relay socket per target |
| Control Center | Renderer | Launch screen, create/join, layout canvas, mode switcher |
| Overlay | Renderer | Ghost window card, bezel glow, mode animations |
| Sidecar bridge | Electron main | Loopback WebSocket to the sidecar, restarts it if it dies |
| Sidecar | Python | Everything that touches Win32 |
| Voice window | Hidden renderer | Microphone, wake phrase, ElevenLabs session, tool calls into main |

## 4. The tab handoff, step by step

Sender A, receiver B, B is A's neighbour on edge E.

1. **Detect.** Sidecar polls every 16 ms. Left button held + foreground window
   class `Chrome_WidgetWin_1` + window rect changing between frames = a drag.
2. **Qualify.** On drag start (not at the edge), a worker thread reads the tab
   count and URL through UI Automation, so the slow call is finished before
   the window reaches the edge. Windows with more than one tab are ignored.
3. **Edge enter.** Window or cursor within 120 px of an edge that has a
   neighbour: sidecar snapshots the window (`PrintWindow` with
   `PW_RENDERFULLCONTENT`, falling back to a screen grab of the window rect),
   scales to max 800 px wide, encodes JPEG q75, sends `LOCAL_WINDOW_PREVIEW`.
   Electron forwards one binary `WINDOW_PREVIEW_FRAME` to B.
4. **Stream.** Each frame, sidecar sends `LOCAL_DRAG_MOVE`; Electron forwards
   `EDGE_DRAG_MOVE {edge, protrusionPx, centerRatio, width, height}`. B's
   overlay draws the snapshot protruding from the opposite edge.
5. **Release.** A release with the cursor touching the edge commits. Anywhere
   else the drag is cancelled and B's ghost slides back out.
6. **Commit.** A sends `TRANSFER_COMMIT` (fields in `plan/contract.md`).
   A hides its window (does not close it yet) and animates its ghost off-screen.
7. **Receive.** B's sidecar launches the URL in a new window of the same
   browser if installed, else the default one. It finds the new window by
   comparing top-level `Chrome_WidgetWin_1` handles before and after, places it
   with `SetWindowPos` under the ghost, and reports `WINDOW_PLACED`.
8. **Confirm.** B's overlay fades the ghost (120 ms). B sends
   `TRANSFER_ACCEPTED`; only then does A close its hidden window. If B reports
   failure or 5 s pass, A shows its window again. A tab is never lost.

Step 6 and 8 differ from the spec, which closes A's window immediately on
release. This is the planner's call, made to satisfy the "never lose a tab"
anti-goal and to make Approval-mode rejects recoverable.

## 5. Coordinates

- The sidecar is per-monitor DPI aware and works in physical pixels.
- Electron works in DIPs; the bridge converts using each machine's `dpiScale`.
- Position along an edge travels as a 0..1 ratio, so screens of different
  resolution line up proportionally.
- Size travels in DIPs and is clamped to the receiver's work area.

## 6. Layout and neighbours

- The host keeps each screen as a rectangle on a grid; cards snap edge to edge.
- Two screens are neighbours on an edge when they touch along it. Each edge
  has at most one neighbour; the larger overlap wins.
- Host broadcasts `LAYOUT_UPDATED` with every device's
  `neighbors {left,right,top,bottom}` on any change, join or leave.
- A newly joined laptop is placed on the next free right-hand edge.

## 7. Messages

`plan/contract.md` is the single source for message names and fields. If this
file and the contract ever disagree, the contract wins. In outline:

- Room server: `CREATE_ROOM`, `JOIN_ROOM`, `JOIN_ACCEPTED`, `JOIN_REJECTED`,
  `MEMBER_JOINED`, `MEMBER_LEFT`, `ROOM_CLOSED`, `KICK_MEMBER`, `LOCAL_PEERS`.
- Room state from the host: `LAYOUT_UPDATED`, `ROOM_STATE`; `MODE_UPDATED`
  from each laptop.
- Handoff: `WINDOW_PREVIEW_FRAME`, `EDGE_DRAG_MOVE`, `EDGE_DRAG_CANCEL`,
  `TRANSFER_COMMIT`, `TRANSFER_ACCEPTED`, `TRANSFER_REJECTED`,
  `TRANSFER_FAILED`, `FILE_PAYLOAD`. The spec's `EDGE_HOVER` is dropped: the
  bezel glow is drawn from `EDGE_DRAG_MOVE`.
- Binary frames: 4-byte length + JSON header + payload, for previews and files.
- Sidecar loopback: `LOCAL_DRAG_*`, `LOCAL_WINDOW_PREVIEW`, window commands,
  `OPEN_URL`, and the voice lookups `GET_ACTIVE_TAB`, `GET_SELECTED_FILE`.

## 8. Modes

Collaborative: auto-accept. Focus: the sender already knows the receiver's
mode, so it does not send; A's window bounces back and nothing opens. Approval: B docks the ghost 90 px in
with Accept/Reject; A's window stays hidden until the answer, with a 30 s
timeout that counts as a reject. Each laptop's mode is broadcast, so the
sender knows the outcome before release.

## 9. Known risks

| # | Risk | Planned handling |
|---|---|---|
| R1 | Windows Snap fires when a window is released at a screen edge (half-screen at left/right, maximise at top) and draws its own preview. | Snap is turned off by hand in Settings on the four demo laptops; on the demo checklist. |
| R2 | A dragged window with several tabs: only the active URL is readable and closing it closes every tab. | Hand off single-tab windows only. |
| R3 | Dragging left or up: the cursor stops at the screen edge, so the window can protrude only by the grab offset, often under 80 px. | A release with the cursor touching the edge commits, on every edge. Protrusion and flick speed only drive the animation. |
| R4 | URL read is slow or fails (browser language, omitted scheme, special pages). | Read at drag start on a worker thread; try several control lookups; no URL means no handoff. |
| R5 | `PrintWindow` returns black for a GPU-drawn window. | Fall back to a screen grab while the window is still fully visible. |
| R6 | The real window on B appears late or steals focus badly. | Ghost stays until `WINDOW_PLACED`; 5 s failure path returns the tab to A. |
| R7 | Windows Firewall blocks port 8080 on the host. | First-run prompt must be accepted; documented in the demo checklist. |
| R8 | Always-on-top overlay hides behind fullscreen apps or costs frame rate. | Verified in the first spike. |
| R9 | 60 Hz forwarding through the host, and through the internet for remote peers, adds lag. | Coalesce to the latest frame; measured on the hotspot and across two networks. |
| R10 | The cloud host sleeps, is slow to wake, or is unreachable. | Relay deployed and checked in the first block; direct-IP join as fallback. |
| R11 | The ElevenLabs client or tool-calling API differs from what the plan assumes (written from memory). | 30 minutes reading the current docs before coding; the four tools are the fixed part. |
| R12 | The wake phrase misfires or misses in a noisy hall. | Hotkey is built first and always works; the wake phrase can be switched off. |

## 10. Order of work (16 hours left, four people, all tiers in scope)

`plan/contract.md` is the contract between the tracks. It is frozen in the
first hour; changes after that are announced to everyone. The task lists in
`plan/` are the detailed version of the table below.

Each track works down its own queue. Tier 1 items come first in every queue.

| Track | Owner | Queue, in order |
|---|---|---|
| T1 Sidecar | Tech 1 | 1. Drag detection, URL read, snapshot, drag streaming. 2. Hide/show/close, open-and-place. 3. Bounce the real window back (Focus). 4. Detect a file drag from Explorer near an edge. |
| T2 Room and transport | Tech 2 | 1. Room server as a standalone `server.js`, deployed to the cloud and embedded in the host; create/join by room number + PIN; forwarding; binary frames; neighbour maths; mode broadcast; sidecar bridge. 2. 500 ms local upgrade, routing by local peers, failover in `TransportManager`; mode hotkeys. 3. File transfer over binary frames. 4. Kick. |
| U1 Control Center | UI 1 | 1. Launch screen, create/join by room number + PIN with the direct-IP fallback, layout canvas. 2. Mode switcher, roster with mode, ping and transport badges, kick buttons. 3. "Send to" direct send. |
| U2 Overlay | UI 2 | 1. Click-through window, ghost card, commit/cancel animations. 2. Bezel glow. 3. Focus bounce, Approval card. 4. Voice indicator and direct arrivals. 5. File card, target pills for direct send. |
| Voice | First tech person free after the first handoff | `plan/voice.md`; ahead of file transfer and kick on that person's list |

Two things keep the later tiers cheap:
- The room server is written from the start as one standalone file that runs
  both inside the host's Electron process and on the cloud host, as the spec
  describes (section 4.1 of `initial_idea.md`).
- `TransportManager` is written from the start around "pick a socket per
  target", so adding the local socket does not touch its callers.

A small replay script that sends recorded `EDGE_DRAG_MOVE`, `WINDOW_PREVIEW_FRAME`
and `TRANSFER_COMMIT` messages lets U2 build the overlay without waiting for T1.

| Hours left | Milestone |
|---|---|
| 16 to 15 | Contract frozen, shared repo, two spikes: URL read; overlay click-through |
| 15 to 10 | Queue item 1 on every track |
| 10 to 8 | First real handoff between two laptops on the hotspot (everyone integrates) |
| 8 to 6 | Four laptops, all four edges, failure path; one handoff with a laptop on a different network |
| 6 to 2 | Remaining queue items: modes, glow, local upgrade and failover, voice assistant, files, direct send, kick |
| 2 to 0 | Feature freeze, rehearsal, demo checklist |

Laptops on the hotspot must still work with no internet: IP + PIN join and
the local socket are tested with the internet switched off.

## 11. Voice assistant

A hidden Electron window owns the microphone. A hotkey (Ctrl+Alt+Space) or the
locally detected wake phrase "Hey Odyssync" (Picovoice Porcupine) starts an
ElevenLabs voice-agent session. ElevenLabs does speech-to-text, the reasoning
and the spoken reply. The agent is given four tools that run inside the app:
`list_members`, `send_current_tab`, `send_selected_file`, `set_mode`.

```
"Hey Odyssync" / hotkey -> voice window -> ElevenLabs agent (cloud)
                                 ^                 |
                                 |   tool call: send_current_tab("Rafi")
                           main/room.js  <---------+
                                 |  GET_ACTIVE_TAB -> sidecar -> url, hwnd
                                 +-> TRANSFER_COMMIT {direct: true} -> Rafi
```

A voice send is a direct send: no drag, no preview stream. The receiver's
mode rules apply unchanged. A single-tab window is moved; a window with
several tabs is copied, because one tab cannot be closed safely on its own.
Details and build steps: `plan/voice.md`.

Planner's calls: a public agent ID in the app config (no key shipped); press
to start rather than hold to talk (global hotkeys have no key-release event);
wake-phrase detection runs on the laptop, so nothing is sent to the cloud
until the phrase or hotkey fires.

## 12. Left to the builder

Files beyond the layout fixed in `plan/contract.md`, UI framework for the renderers,
animation implementation, test tooling, exact timings where the spec gives none.

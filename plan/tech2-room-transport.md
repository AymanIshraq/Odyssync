# Tech 2 — Room server, relay, transport, bridge

You own `app/main/*` and `app/server/server.js`. You have the heaviest first
block; do the steps in this order and hand the preloads to the UI people early.

## Hour 16 to 15

1. Create the repo and the folder layout from `contract.md`.
2. `app/main/index.js`: open the Control Center window and the overlay window
   (flags in `ui2-overlay.md`), load placeholder pages.
3. `preload-control.js` and `preload-overlay.js` exposing `window.odyssync`
   with **stub** implementations that return fake data, so UI 1 and UI 2 can start.
4. `tools/replay.js`: reads a JSON file of overlay events and feeds them to
   the overlay on a timer. Record one fake drag by hand.

## Item 1 — room and handoff path (hours 15 to 10)

a. `server/server.js` (`ws` package, no Electron imports): rooms map, PIN
   check, `CREATE_ROOM`, `JOIN_ROOM`, forwarding by `toId` (JSON and binary),
   `"*"`, `MEMBER_JOINED/LEFT`, `ROOM_CLOSED` when the host's socket closes,
   `LOCAL_PEERS`, ping. Exports `start({ port })`. Max 8 members.  → E1.3, E1.5
b. Deploy `server.js` to Railway or Render now; put the `wss://` URL in one
   config file. Check it from two laptops.  → E7.1
c. `transport.js`: cloud socket; `sendToPeer`, `sendBinaryToPeer`, `onMessage`;
   `mid` counter and de-duplication. Written around "pick a socket per
   target" so step (item 2) adds the local socket without touching callers.
d. `room.js`: create (generate room number and PIN, start embedded server,
   register with the relay), join, leave; member list; host keeps `screens`,
   computes `neighbors` (touching edges, larger overlap wins), sends
   `LAYOUT_UPDATED` on change and `ROOM_STATE` to newcomers; auto-place a new
   screen to the right of the last one. Keep every member's mode from
   `MODE_UPDATED` and send your own on `setMode` (the sender rules need it).
   Apply the "who is in the room" rules in `contract.md`. Pushes state to the
   Control Center.  → E1.1–E1.5, E2.4, E5.2
e. `sidecar-bridge.js`: ws server on `127.0.0.1:8089`, spawn
   `python sidecar/win32_daemon.py`, restart it if it exits, send
   `SET_ACTIVE_EDGES` on every layout change.
f. Handoff state machine in `room.js`: the Sender rules and Receiver rules in
   `contract.md`, including pixel/DIP conversion, edge flipping for overlay
   events, and the 5 s return-the-tab timeout.  → E4.3–E4.6

Direct-IP join: `joinRoom({ directIp })` connects straight to
`ws://<ip>:8080` and skips the relay.  → E7.4

## Hours 10 to 6: integrate with everyone

## Item 2 — local upgrade (after hour 6)  → E7.2, E7.3, E7.7

After `JOIN_ACCEPTED`, race `ws://<ip>:<port>` for each `hostLocalIps` with a
500 ms timeout. First to open becomes the local socket; send `JOIN_ROOM` on
it. Route by `LOCAL_PEERS`. Add the mode hotkeys Ctrl+Alt+1/2/3 (`globalShortcut`).
On local close, fall back to the cloud socket silently. Expose each member's
path (`"local" | "relay"`) and ping in the state.

## Voice assistant

If you are free before Tech 1 after the first handoff works, you build
`voice.md`. It comes before items 3 and 4 below. The voice file command
needs item 3.

## Item 3 — file transfer  → E6.1

Overlay drop gives a path → read the file → `TRANSFER_COMMIT {kind: "file"}`
then `FILE_PAYLOAD`. Receiver writes to `Downloads\Odyssync\` and opens
Explorer with the file selected, after the mode rules.

## Item 4 — kick  → E6.3

`KICK_MEMBER` closes the target's sockets on both servers.

## Done when

Your checks pass with four laptops on the hotspot plus one on another network.

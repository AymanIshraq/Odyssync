# Odyssync — Progress

Last updated: 2026-11-15

**Overall: about 25% built. About 75% left.** Four people (two tech, two UI); 16 hours remained when planning began.

Percentages are each component's share of all the work. Every tier is in scope.

## Planning

- [x] Scope agreed with the user (demo moment, four laptops, all four tiers)
- [x] Approaches chosen (Python sidecar, open on release)
- [x] `project-brief.md`, `architecture.md`, `feature_expectation.md` drafted
- [x] Architecture stress-tested (round 1; recommendations applied, user may still change them)
- [x] Design approved by the user (2026-11-14)
- [x] Per-track task lists written (`plan/`)

## Tier 1 — core (55%)

UI 2 local implementation: the isolated moving-box spike and Item 1 ghost
renderer are present. The ghost replay runs through the spike's optional
`--ghost-replay` harness; shared main/preload and `tools/replay.js` are still
absent. Four automated renderer tests and syntax checks pass. Native desktop,
real handoff, and two-laptop/DPI acceptance remain unverified, so completion
percentages below remain at 0% accepted (100% acceptance work remains).

| # | Component | Track | Share | Done |
|---|---|---|---|---|
| 0 | Spikes: URL read, overlay click-through | T1, U2 | 3% | 0% |
| 1 | App shell and sidecar bridge | T2 | 5% | 90% (shell, preloads, replay tool and full bridge done and tested with a pretend sidecar; starting the real Python helper on Windows is untested) |
| 2 | Room server, join, message forwarding | T2 | 8% | 90% (`server.js`, `transport.js` and `room.js` create/join/leave done and tested with pretend laptops and in the app on a Mac; not yet run on Windows laptops or through Railway) |
| 3 | Layout canvas and neighbour map | U1, T2 | 8% | 45% (T2 half done: host layout, auto-placement, neighbour maths, broadcast; UI 1's canvas left) |
| 4 | Sender: drag detection, URL, snapshot, streaming | T1 | 10% | 0% |
| 5 | Overlay: ghost rendering in lockstep | U2 | 8% | 0% |
| 6 | Commit, receive, place, confirm, failure path | T1, T2 | 8% | 45% (T2 half done: sender and receiver rules for all three modes in `handoff.js`, tested with pretend sidecars and overlays; Tech 1's sidecar half and a real Windows test left) |
| 7 | Four-edge and four-laptop integration | all | 5% | 0% |

## Tier 2 — impressive (15%)

| # | Component | Track | Share | Done |
|---|---|---|---|---|
| 8 | Bezel glow | U2 | 3% | 0% |
| 9 | Modes: broadcast, switcher, hotkeys | U1, T2 | 3% | 40% (mode broadcast done; switcher and hotkeys left) |
| 10 | Focus bounce | U2, T1 | 3% | 0% |
| 11 | Approval prompt | U2 | 4% | 0% |
| 12 | Canvas animations | U1 | 2% | 0% |

## Tier 3 (14%)

| # | Component | Track | Share | Done |
|---|---|---|---|---|
| 13 | File drag and drop, transfer, file card | T1, T2, U2 | 6% | 0% |
| 14 | Direct send: target pills and "Send to" | U2, U1 | 4% | 0% |
| 15 | Kick | T2, U1 | 2% | 60% (server and app side done; UI 1's button left) |
| 16 | Roster with ping, mode and transport badges | U1 | 2% | 0% |

## Tier 4 — remote collaboration (10%), relay starts in the first block

| # | Component | Track | Share | Done |
|---|---|---|---|---|
| 17 | Cloud relay deployed, room-number join | T2, U1 | 5% | 85% (relay live on Railway at `wss://odyssync-production.up.railway.app`, address in `app/config.json`; create and join by room number + PIN verified through it from one Mac with the real app as host; two real laptops on different networks not yet tried) |
| 18 | Local upgrade race and failover | T2 | 5% | 0% |

## Voice assistant (6%), added 2026-11-14

| # | Component | Track | Share | Done |
|---|---|---|---|---|
| 19 | Voice window, hotkey, ElevenLabs session, tab/mode/members tools | first free tech | 4% | 0% |
| 20 | Wake phrase, file tool, overlay indicator | first free tech, U2 | 2% | 0% |

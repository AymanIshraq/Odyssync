# Odyssync — Project Brief

Status: APPROVED by the user 2026-11-14. Task lists are in `plan/`.
Source: `initial_idea.md` plus the planning conversation of 2026-11-14.
Where this brief and `initial_idea.md` disagree, this brief wins.
The product is named **Odyssync** (decided by the user). `initial_idea.md` and
the project folder still use the working name DeskMesh.

## What it is

A Windows 10/11 desktop app, built for a 24-hour hackathon, that makes several
laptops behave like a single shared desk, whether they sit on one Wi-Fi hotspot
or in different places. Every person keeps their own mouse and keyboard. Anyone
can drag a browser tab or file off the edge of their screen and have it arrive
on the teammate placed on that side, or ask for it by voice.

It is not a KVM tool: nobody controls anyone else's machine.

## The demo moment (decided by the user)

**An open browser tab goes from one PC to another seamlessly.** Four laptops are
in the demo. It is built first because every other feature rests on it.

## Whole product, not only the demo (decided by the user)

The team is building all of Odyssync as specified: local and remote
collaboration, every mode, files, direct send and room management. The tab
handoff is built first because everything else rests on it, not because the
rest is optional.

## Voice assistant (added by the user, 2026-11-14)

Say "Hey Odyssync" (or press a hotkey), ask it to send a tab or file to
someone, and it answers out loud in an ElevenLabs voice and does it.

Decided by the user:
- ElevenLabs' voice agent handles listening, understanding and speaking, and
  calls functions inside the app.
- Hotkey first, then the "Hey Odyssync" wake phrase on top; both ship.
- First version does four things: send this tab to a person, send the file
  selected in File Explorer to a person, change my mode, say who is in the room.
- It follows the same Focus and Approval rules as dragging.
- Built by the first tech person to finish their handoff work, ahead of file
  transfer and kick, which become the items most likely to be missed.

It needs internet, an ElevenLabs account, a Picovoice account for the wake
phrase, and microphone permission on each laptop.

## Goals

1. A tab dragged past a screen edge visibly crosses the bezel and lands as a
   real browser window on the neighbouring laptop, in the matching position.
2. It works between any two neighbours among four laptops, on all four edges.
3. It works between laptops on the same hotspot (direct and fast) and between
   people in different places (through the cloud relay), from one codebase,
   with the app choosing the path automatically.
4. Laptops on the same hotspot keep working if the internet drops.

## Non-goals

- macOS or Linux support.
- Browser extensions (the spec forbids them).
- Carrying page state. The tab arrives as the same URL opened fresh: scroll
  position, form input, video position and logins do not travel.
- A delivery queue for transfers.
- Multi-monitor laptops. The overlay covers the primary display only.

## Anti-goals (it fails even if it technically works)

- The handoff looks like "window closes here, a different window pops up
  there". The crossing has to read as one continuous motion.
- A tab is ever lost: closed on the sender and never opened on the receiver.
- The overlay blocks or delays normal mouse and keyboard use on any laptop.
- Laptops on the same hotspot stop working when the internet drops.

## Scope, in build order

| Tier | Contents |
|---|---|
| 1. Core, must be flawless | Create/join a room by room number + PIN, with host IP + PIN as the offline fallback. Layout canvas where the host arranges four screens, and the neighbour map sent to everyone. Detecting a dragged Chrome/Edge/Brave tab. Reading its URL. Snapshot peeking across the bezel during the drag. On release: the tab is hidden on A, the real window opens on B in the same spot, then A's copy closes. All four edges. |
| 2. Makes it impressive | Bezel glow. Modes: Collaborative, then Focus bounce, then Approval prompt. Canvas snap animations. Mode hotkeys (Ctrl+Alt+1/2/3). |
| 3. More ways to share | File drag and drop. Direct send to a non-adjacent laptop. Kick controls. Roster with ping and transport badges. |
| 4. Remote collaboration | Cloud relay, 6-digit room-number lookup, automatic local upgrade. The relay and room-number join are built in the first block; the local upgrade follows. |
| Voice assistant | "Hey Odyssync": hotkey, wake phrase, four spoken commands. Starts after the first real handoff. |

The tiers describe the order inside each person's list (see `plan/`), not a
wall between phases. A bundled installer is not planned; the app runs from source.

## Decisions the user made

- Demo moment: seamless tab handoff.
- Four laptops in the demo.
- Windows only; development and testing move to a Windows laptop.
- Windows layer: Python sidecar next to Electron (not Node-only).
- Receiver opens the real tab on release (not pre-opened during the drag).
- Planning output lives in `memory-bank/`.

## Calls made by the planner (correct any of these)

- Joining is by 6-digit room number + PIN through the cloud relay, as in the
  spec. Join by host IP + PIN is kept as the offline fallback.
- Direct send by pills and "Send to" stays late in the lists. The voice
  assistant uses the same direct path and brings its receiving side forward.
- Section 3.8 (Room Member view) is missing from the spec. Assumed: the same
  screen as the manager, with the canvas read-only and no kick or End Room.
- Section 5.4 is cut off mid-sentence. Only "Mechanism 1" (target pills) is
  specified; "Mechanism 2" is treated as a "Send to" list in the Control Center.
- Only single-tab windows are handed off by dragging (see architecture, risk
  R2). A voice or "Send to" send of a window with several tabs copies the
  active tab instead of moving it.

## Time and team (told by the user, 2026-11-14)

- The 24 hours have started. **16 hours remained when planning began**; the
  schedule counts in hours left, so start from wherever the clock is now.
- Four people: two on the non-UI tech, two on the UI.
- Nothing has been built yet.

## Scope for the 16 hours left (decided by the user)

**Nothing is cut.** Tiers 3 and 4 are features the team wants to build. The
tiers now set the order of work, not what is in or out.

- The tab handoff is still built and integrated first.
- The cloud relay is no longer a late add-on: the room server is deployed to
  the cloud in the first block, next to the local one.
- Each of the four tracks moves on to its tier 2, 3 and 4 items as soon as its
  tier 1 work is done (see `architecture.md`, section 10).
- When the handoff is ready to integrate, integration takes priority over
  whatever else a track is doing.
- No new features in the last two hours; they are for rehearsal and fixes.

Planner's note: all four tiers in 16 hours is tight. If time runs short, the
last items in each track's queue are the ones that will not be reached.

## Stress-test answers applied as the planner's recommendation

The user has not objected to these; any can still be changed.

- The sender's tab is hidden on release and closed only on confirmation.
- Single-tab windows only, for drags.
- Windows Snap is turned off by hand in Settings on the four demo laptops
  (no code, given the time left).
- A release with the cursor touching the edge sends; anywhere else cancels.
- The room ends if the host leaves. Host laptop plugged in, sleep disabled.
- Join by room number + PIN through the relay; host IP + PIN as the offline
  fallback. Both are built in the first block.
- Chrome on all four laptops.
- Run from source; Python and Node installed on each laptop beforehand.

## Open items

- None blocking. Nothing was built in the first 8 hours; the team was planning.

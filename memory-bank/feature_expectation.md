# Odyssync — Feature Expectations

Status: APPROVED by the user 2026-11-14. Task lists are in `plan/`.
Checked after every build loop. Each line is something a person can observe on
real Windows laptops. A component is done only when its lines all pass.

## Tier 1 — core

### Room
- [ ] E1.1 Launch screen shows a display name pre-filled with the machine name, plus Create and Join.
- [ ] E1.2 Create shows a 6-digit room number, a 4-digit PIN and the host's local IP addresses, with a copy button.
- [ ] E1.3 Join with the right room number and PIN enters the room in under 3 s; a wrong one shows an error and stays on the join screen. Join by host IP and PIN also works.
- [ ] E1.4 Four laptops can be in one room at once on a Windows Mobile Hotspot with no internet.
- [ ] E1.5 A laptop that quits disappears from everyone's canvas within 3 s. If the host quits, every other laptop returns to the launch screen with a notice.

### Layout
- [ ] E2.1 Each laptop appears on the canvas as a card with its display name.
- [ ] E2.2 Only the host can drag cards; a released card snaps to the nearest free edge of another card.
- [ ] E2.3 A row of four and a 2x2 grid can both be arranged.
- [ ] E2.4 After any change, every laptop has the correct neighbour for each of its four edges within 200 ms.

### Overlay
- [ ] E3.1 With the overlay running, every other app receives clicks, scrolling and typing as normal.
- [ ] E3.2 The overlay stays above normal windows and the taskbar.
- [ ] E3.3 Nothing is drawn while no drag is in progress.

### Tab handoff
- [ ] E4.1 Dragging a single-tab Chrome window to an edge with a neighbour makes a snapshot of it appear at the matching edge of the neighbour's screen.
- [ ] E4.2 While the drag continues, the snapshot on the neighbour follows it with no visible lag on the hotspot.
- [ ] E4.3 Pulling the window back cancels: the neighbour's snapshot slides away and nothing opens.
- [ ] E4.4 Releasing with the cursor at the edge opens the same URL as a real browser window on the neighbour, at the snapshot's position, within 2 s, and the snapshot fades out.
- [ ] E4.5 The sender's window is gone after a successful handoff, and only then.
- [ ] E4.6 If the neighbour fails to open the tab, the sender's window comes back within 5 s. No tab is ever lost.
- [ ] E4.7 E4.1 to E4.5 pass on the left, right, top and bottom edges.
- [ ] E4.8 Dragging to an edge with no neighbour does nothing.
- [ ] E4.9 Dragging a window with several tabs to an edge does nothing.
- [ ] E4.10 Windows Snap is off on all four demo laptops (set by hand; demo checklist).
- [ ] E4.11 Works in Chrome; Edge is checked as the backup.
- [ ] E4.12 Twenty handoffs in a row around four laptops succeed without a restart.

## Tier 2 — impressive

- [ ] E5.1 Bezel glow tracks the drag on both the sender's and the receiver's edge, in the receiver's mode colour.
- [ ] E5.2 The mode switcher and Ctrl+Alt+1/2/3 change mode, and every laptop's canvas shows the new mode within 200 ms.
- [ ] E5.3 Focus: a release at the edge bounces the real window back onto the sender's screen; nothing appears on the receiver.
- [ ] E5.4 Approval: the snapshot docks at the receiver's edge with Accept and Reject, and the buttons are clickable while the rest of the screen stays click-through.
- [ ] E5.5 Approval Accept completes as in E4.4. Reject, or 30 s with no answer, returns the tab to the sender.
- [ ] E5.6 Canvas cards animate on join, leave and snap.

## Tier 3 — in scope, after tier 1 is integrated

- [ ] E6.1 A file dragged from Explorer to an edge arrives in the neighbour's `Downloads\Odyssync` folder.
- [ ] E6.2 A tab can be sent to a non-adjacent laptop without anything showing on the laptops in between.
- [ ] E6.3 The host can kick a member, who returns to the launch screen with a notice.
- [ ] E6.4 The roster shows each member's ping and mode.

## Tier 4 — remote collaboration (relay built in the first block)

- [ ] E7.1 Joining by 6-digit room number and PIN through a cloud relay.
- [ ] E7.2 Automatic switch to a direct local connection when one is reachable.
- [ ] E7.3 If the direct connection drops, the session continues over the relay without rejoining.
- [ ] E7.4 With no internet at all, join by IP + PIN and the tab handoff still work.
- [ ] E7.5 A tab handed off between two laptops on different networks arrives as in E4.4, within 4 s.
- [ ] E7.6 A room can hold laptops on the hotspot and a remote laptop at once, and each can hand off to its neighbour.
- [ ] E7.7 Each card on the canvas shows whether that laptop is on the local or the relay path.

## Voice assistant

- [ ] E8.1 Ctrl+Alt+Space starts listening from any app, and an indicator shows on the overlay.
- [ ] E8.2 Odyssync answers out loud in the ElevenLabs voice within about 2 s of the user finishing.
- [ ] E8.3 "Send this tab to <name>" delivers the tab the user was looking at to that person, who need not be a neighbour, and Odyssync confirms out loud.
- [ ] E8.4 "Put me in Focus mode" changes the mode, visible on every laptop's canvas.
- [ ] E8.5 "Who's in the room?" reads out the members and their modes.
- [ ] E8.6 "Send this file to <name>" delivers the file selected in File Explorer.
- [ ] E8.7 Saying "Hey Odyssync" starts listening without the hotkey; a toggle turns this off.
- [ ] E8.8 A target in Focus mode, an unknown name, no tab, no selected file, or no internet each produce a spoken or shown explanation, and nothing is sent.
- [ ] E8.9 Odyssync never says something was sent when it was not.

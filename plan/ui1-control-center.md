# UI 1 — Control Center (`app/control/`)

You talk only to `window.odyssync` (see `contract.md`, "Renderer API"). Tech 2
gives you a stub of it in the first hour, so build against fake data until the
real one lands. Style: dark, glass panels; mode colours cyan `#00F0FF`, amber
`#FFB800`, red `#FF2A54`.

## Hour 16 to 15

Install Node, Python and Chrome on all four laptops, turn Snap off, check the
hotspot (see `README.md`, Setup). Then start item 1.

## Item 1 — launch, join, canvas (hours 15 to 10)

a. Launch screen: display name field pre-filled with the machine name; two
   cards, Create a Room and Join a Room.  → E1.1
b. Join: six slots for the room number, four for the PIN; a small
   "Offline / Direct IP" link that swaps the room number for an IP field.
   Show `reason` on failure and stay on the screen.  → E1.3
c. Room screen header: room number, PIN, local IPs, Copy Invite, Leave (End
   Room for the host).  → E1.2
d. Layout canvas: one 16:9 card per `screens` entry, sized from its `w`/`h`,
   showing display name and a number badge. Host only: drag a card; on release
   snap it to the nearest free edge of another card so edges touch exactly,
   then call `odyssync.setLayout(screens)`. Members see it read-only and
   updating live. Must allow a row of four and a 2x2 grid.  → E2.1–E2.3
e. `onNotice`: kicked / room closed returns to the launch screen with the text.  → E1.5

## Hours 10 to 6: integrate with everyone

## Item 2 — modes and roster (after hour 6)

a. Three-way mode switcher at the top, calling `odyssync.setMode`; mode pill
   on every card.  → E5.2
b. Roster sidebar: name, mode badge, path badge (Local / Relay), ping; a red
   Kick button on every row but the host's, host only.  → E6.3, E6.4, E7.7
c. Card animations on join, leave and snap.  → E5.6

## Item 3 — direct send  → E6.2

A "Send to" control per card that calls `odyssync.sendDirect(deviceId)`;
cards in Focus mode show "Focus Locked" and shake instead of sending.

## Done when

Your checks pass with four real laptops in the room.

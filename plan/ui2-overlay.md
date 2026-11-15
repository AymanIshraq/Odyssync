# UI 2 — Overlay (`app/overlay/`)

A fullscreen transparent window that draws the crossing. You receive events
through `odyssync.onEvent` (see `contract.md`, "Renderer API"). Edges in your
events are already **this screen's** edge and all numbers are DIPs.

Window flags (in `main/index.js`, agree with Tech 2): `transparent: true,
frame: false, fullscreen: true, skipTaskbar: true, focusable: false`,
`setAlwaysOnTop(true, 'screen-saver')`,
`setIgnoreMouseEvents(true, { forward: true })`.

## Hour 16 to 15: spike

`tools/spikes/overlay/`: the window above, drawing one moving box. Pass = you
can click, scroll and type in Chrome and Explorer underneath, the box stays
above the taskbar, and it runs at 60 fps. Tell everyone if any of that fails.  → E3.1–E3.3

## Item 1 — the ghost (hours 15 to 10)

Build against `tools/replay.js` until the real events arrive.

a. `PREVIEW`: preload the image in a hidden `<img>`.
b. `DRAG_MOVE`, role receiver: draw the image as a card `width` x `height`,
   pushed `protrusionPx` inward from the event's edge, centred at
   `centerRatio` along it, clamped to the screen. Use `transform` only; one
   `requestAnimationFrame` loop that applies the latest event.  → E4.1, E4.2
c. `CANCEL`: slide the card back out over 160 ms.  → E4.3
d. `COMMIT`, role receiver: spring the card fully on-screen
   (`cubic-bezier(0.16, 1, 0.3, 1)`, 260 ms, a 4 px blur that settles to 0),
   then call `odyssync.ghostSettled(transferId, rect)`.
e. `PLACED`: fade the card out over 120 ms.  → E4.4
f. `FAILED` / `REJECTED`, role receiver: push the card back out.
g. Role sender: on `COMMIT`, whip a ghost of the window off the edge over
   160 ms; on `REJECTED`/`FAILED` play a short recoil at the edge.
h. Several transfers at once: key every card by `transferId`.

## Hours 10 to 6: integrate with everyone

All four edges (E4.7).

## Item 2 — bezel glow (after hour 6)  → E5.1

On `DRAG_MOVE` for both roles: a 14 px by 300 px glowing strip on the edge
following `centerRatio`, coloured by the event's `mode`.

## Item 3 — Focus bounce and Approval card  → E5.3–E5.5

a. `BOUNCE`: red ripple along the edge; card squashes
   (`scaleX(0.91) scaleY(1.04)`, 80 ms) and rebounds
   (`cubic-bezier(0.34, 1.56, 0.64, 1)`, 340 ms).
b. `COMMIT` with `mode: "approval"`: dock the card 90 px inward with a pulsing
   amber border and a 340 x 140 card: "Incoming tab from <fromName>", title,
   shortened URL, Accept and Reject.
c. Track the cursor from forwarded `mousemove`; call
   `odyssync.setInteractive(true)` while it is over the card and `false` when
   it leaves. Buttons call `odyssync.answer(transferId, accepted)`.

## Voice indicator and direct arrivals  → E8.1

Show a small indicator for `VOICE {state}`. A `COMMIT` with no drag before
it slides the card in from the edge facing the sender, or the nearest edge.

## Item 4 — files and direct send  → E6.1, E6.2

a. On a file-drag event, show a 90 px drop strip on that edge that accepts
   drops; pass the dropped path to main; show a file card (name, icon, size)
   that uses the same animations as a tab.
b. Holding at the edge for 250 ms shows target pills for every member;
   releasing over one sends directly to that person.

## Done when

Your checks pass on two laptops with different display scaling.

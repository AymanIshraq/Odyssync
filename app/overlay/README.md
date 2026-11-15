# Overlay: ghosts, bezel glow, Focus bounce and Approval

Loads against the contract's `window.odyssync.onEvent` and `ghostSettled` APIs.
All dimensions are DIPs. Renderer edges are used directly, without flipping.
The document is transparent and empty until a transfer is drawn.

Implemented: hidden preview loading, latest-move positioning on four edges,
screen-size clamping, 160ms cancellation/return, 260ms receiver settlement
with cubic-bezier(0.16, 1, 0.3, 1) and 4px-to-zero blur, 120ms placement fade,
sender exit/rejection recoil, and independent cards keyed by transferId.
Only one requestAnimationFrame chain applies visual updates. Failed images
leave a navy/cobalt placeholder; late image callbacks cannot revive removed cards.
Sender ghosts remain hidden after exit until a terminal event arrives, allowing
a later rejection to recoil. The harness closes automatically after five minutes.

## Local replay

The shared `tools/replay.js` and app main/preload do not exist yet. An isolated
fixture lives in `tools/spikes/overlay/replay.cjs`; its preload supplies only
the existing contract methods. No shared main process was created or changed.

From the repository root:

```powershell
npm.cmd --prefix tools/spikes/overlay run ghost
npm.cmd --prefix tools/spikes/overlay run check
npm.cmd --prefix tools/spikes/overlay test
```

Stop: Ctrl+Alt+Shift+Q, Ctrl+C in the terminal, or the five-minute timeout.
The original moving-box spike still launches with `npm.cmd --prefix tools/spikes/overlay start`.

The replay runs once: four overlapping edge arrivals, cancellation, receiver
commits, placement fades, a failed receiver transfer, and sender rejection.
Inspect the preview and animation timing visually; receiver settlement is logged
in the renderer console by the fixture rather than sent to a real sidecar.
After the ghost sequence, the bezel replay sweeps all four edges for both
roles in collaborative, approval and focus modes. The full sequence finishes
at about 18 seconds, leaving the overlay empty.

Automated Node tests cover edge geometry, size clamping, event coalescing,
settlement timing/once-only acknowledgement, fade/removal, concurrent transfers,
late image callbacks, cancellation, failure, and sender recoil. They use a fake
DOM and clock; they do not validate Chromium rendering or desktop behavior.

Unverified: native launch/rendering, smoothness and GPU performance, actual
image decoding, Chrome/Explorer click/scroll/type pass-through, taskbar stacking,
stop hotkey and timeout, real bridge/sidecar handoff, and two laptops with
different display scaling. E4.1–E4.4 cannot be marked passed end-to-end yet.
Voice indicator and file-card presentation are implemented below. Native file
drop and target selection await contract definitions.

## Item 2: bezel glow

On DRAG_MOVE, each transfer gets an independent 14 by 300 DIP strip, centered
on centerRatio and clamped along its edge. Top/bottom strips are horizontal;
left/right strips are vertical. Small viewports shorten the strip to fit.
Both sender and receiver roles use the renderer's edge without flipping it.
Movement shares the ghost renderer's single rAF loop and uses transform.
Resize is reflected on the next frame; no devicePixelRatio conversion occurs.

Mode colors: collaborative cobalt (#155cf4), approval orange (#ff7618), focus
red (#ef4444). The plan specifies mode-dependent colors but no exact palette;
these use the approved cobalt/orange accents and red for focus feedback.
Cancel, commit, placement, failure, rejection and bounce remove the strip.
The rest of the screen stays transparent and mouse-through.

Seven automated tests cover the renderer behavior, including four-edge ghost
settlement/exit, bezel dimensions, ratio bounds, both roles, mode updates,
resize, simultaneous transfers and cleanup. E4.7 integration remains pending:
the repository has no shared main/preload, room transport or sidecar to wire
into this renderer yet. Validate E4.1–E4.5 on each edge with those tracks and
two real laptops before marking E4.7 passed. E5.1 native glow appearance and
desktop behavior likewise remain unverified by these Node tests.

## Item 3: Focus bounce and Approval

BOUNCE displays a red edge ripple and squashes the ghost to scaleX(0.91),
scaleY(1.04) over 80ms, then rebounds over 340ms using
cubic-bezier(0.34, 1.56, 0.64, 1). Both effects share the existing frame loop.
The renderer supplies visual feedback only; BOUNCE_WINDOW and restoring the
actual sender window remain sidecar/main responsibilities.

Receiver approval COMMIT docks the preview 90 DIPs inward, clamped to the
viewport. Its 340 by 140 DIP panel contains sender, title, shortened URL,
Accept and Reject, with an amber border pulse (disabled for reduced motion).
Strings are rendered as text, never HTML. The panel shrinks only when the
viewport cannot fit its normal dimensions.

Forwarded mousemove coordinates are hit-tested against all active approval
panels. The renderer calls setInteractive only when the union's hover state
changes, and clears interactivity on pointer leave, blur, page exit, response,
external termination or expiry. Only the approval panels have CSS pointer
events enabled. The native main/preload must honor setInteractive by toggling
setIgnoreMouseEvents, retaining forwarding when click-through is enabled.
Focusable remains false in the isolated harness; mouse interaction is the
native test path, and keyboard focus/navigation is not claimed as verified.

Accept/Reject call answer(transferId, accepted) once per displayed panel.
Accept then settles the ghost and calls ghostSettled after the settlement
animation; Reject returns it outward. After 30 seconds the local panel expires
and returns the ghost without accepting. Main owns the authoritative 30-second
timeout rejection and sender restoration; the renderer does not invent a
timeout bridge method or send an explicit user rejection for timeout.

The existing replay command now adds four-edge bounce at about 19–22 seconds,
then two approval requests at about 23 seconds. Click Accept on one and Reject
on the other, or leave them unanswered until about 53 seconds. The harness
logs answers in the launch terminal and simulates PLACED/REJECTED; it never
opens or transfers a real tab. Move onto/off each panel and verify clicks and
scrolling reach Chrome/Explorer outside it. Check that cleanup restores full
click-through after answering and expiry. Repeat at all four edges with the
real bridge and different display scaling before accepting E5.3–E5.5.

Eleven Node tests and syntax checks pass. These use a fake DOM and clock;
native rendering, ripple/border appearance, actual click-through transitions,
focus retention, desktop input, real rejection/timeout restoration and real
two-laptop acceptance remain unverified. Shared app main/preload and sidecar
are still absent. No files in memory-bank were changed for Item 3.

## Voice, direct arrivals and file cards

VOICE states listening, thinking and speaking update a small passive indicator.
Idle hides it, keeping the inactive overlay transparent. Unknown states are
ignored. No microphone or voice session is started by this renderer.

A receiver COMMIT needs no earlier preview or drag. It displays title/URL or
filename/icon/size, enters from the supplied renderer edge, and uses normal
settlement/approval/placement behavior. When edge is absent, the last forwarded
cursor position selects its nearest edge; RIGHT is the deterministic fallback
when cursor position is unavailable. This does not infer device layout.
Sender COMMIT without prior drag now starts fully on-screen before its exit.

File metadata uses textContent, finite nonnegative sizes and the same ghost
animations. It does not read, upload or write files. The native drop strip,
250ms member picker and release-to-send are not wired: the current contract
does not define their required overlay bridge. See
[integration gaps](../../plan/ui2-integration-gaps.md) for exact ownership and
missing definitions. The user chose to preserve the existing contract.

The local replay shows voice state changes during its first seven seconds,
then preview-free tab and file arrivals at about 6.5 seconds. All are synthetic;
no physical connection or actual transfer is implied. Sixteen automated tests
pass, including preview-free arrivals on every edge, fallback-edge selection,
file metadata, voice transitions and direct approval/focus behavior. Native
desktop, two-laptop and real file/voice integration remain unverified.

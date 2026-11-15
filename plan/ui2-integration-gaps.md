# UI 2 integration status

The contract is unchanged. The user requested that missing integration points
be documented rather than invented. No memory-bank files were changed in this
work. The existing memory-bank/progress.md modification predates this task.

## Implemented against the current renderer contract

- Ghost lifecycle, four-edge geometry and concurrent transfer IDs.
- Mode-colored bezel glow for sender and receiver.
- Focus bounce visuals and approval UI using answer/setInteractive.
- VOICE listening/thinking/speaking indicator; idle hides it.
- Direct COMMIT without PREVIEW or DRAG_MOVE: readable fallback card enters
  from its renderer edge. With no edge, use the edge nearest the last forwarded
  pointer position; without either, use RIGHT. No sender direction is invented.
- File COMMIT renders filename, document icon and size through the ghost
  lifecycle, including approval. This is presentation, not a file transfer.

## Item 4: missing contract definitions

| Required behavior | Missing integration | Owner |
| --- | --- | --- |
| Reveal a 90-DIP drop strip on an active edge | Overlay delivery of sidecar LOCAL_FILE_DRAG, active edge and cancellation semantics. LOCAL_FILE_DRAG is currently specified only on the sidecar-to-main connection. | Main/preload + sidecar |
| Capture a native file drop | Approved renderer-to-main submission method, native file-path extraction in preload, validation/result semantics, and rules for enabling drop hit testing. Existing setInteractive is specified for Approval. | Main/preload |
| Show target pills after 250ms | Overlay member/target updates with device IDs, names, self exclusion, availability/mode and removal semantics; definition of which drag/hold activates the picker. | Room/main/preload |
| Release on a target to send | Overlay command for selecting a target and choosing the active tab/file/transfer. sendDirect(deviceId) currently belongs to the Control Center API only. | Room/main/preload |

The drop strip and target picker are not connected or represented as working
features. Enabling them without those definitions could intercept Explorer
input without a usable transfer path. UI 2 can implement the remaining
interaction once the bridge owner provides an agreed contract extension.
No new renderer APIs, IPC production channels or network messages were added.

## Native acceptance still required

The repository has no shared app main/preload, room transport, sidecar or
tools/replay.js. Local synthetic replay lives under tools/spikes/overlay.
Node tests do not establish E4.7, E5.3–E5.5, E6.1–E6.2 or E8.1 end-to-end.
Check Chrome/Explorer input, focus, taskbar stacking, GPU/FPS, native drop paths,
timeout/restoration and real transfers on two laptops at different scaling.

Run from the repository root:

```powershell
npm.cmd --prefix tools/spikes/overlay run check
npm.cmd --prefix tools/spikes/overlay test
npm.cmd --prefix tools/spikes/overlay run ghost
```

Stop with Ctrl+Alt+Shift+Q; the isolated harness also expires after five minutes.

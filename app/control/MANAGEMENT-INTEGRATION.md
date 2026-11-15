# Room management integration

The user requested working join approvals and per-person sharing controls after the original Item 1 scope. They work in the isolated preview. No Electron main process or room server exists in this checkout, so these are not yet enforced between real laptops.

`plan/contract.md` and all `memory-bank` files remain unchanged. The following **optional extension** is implemented by `preview-api.js`; it is not part of the frozen production contract. Coordinate it with Tech 2 before integrating the native bridge.

## Proposed bridge surface

```js
window.odyssync.management.setManualApproval(enabled) // Promise<void>
window.odyssync.management.answerJoinRequest(requestId, accepted) // Promise<void>
window.odyssync.management.setSharingPermission(deviceId, allowed) // Promise<void>
```

Each method changes host-owned state and emits a fresh full `onState` snapshot. Failures reject without changing the saved setting. The optional snapshot field is:

```js
management: {
  manualApproval: true,
  joinRequests: [{ requestId, member: { deviceId, profile: { displayName } } }],
  sharingPermissions: { /* deviceId: boolean; permission to send tabs/files */ }
}
```

When this extension is absent, production controls remain disabled rather than saving unenforced preferences. Only the host sees the Join requests and Sharing permissions panels. Members cannot open these dialogs; losing the host role closes an open management dialog. Host sharing access stays on. Share permission applies to the sender; a recipient's Focus/Approval mode still applies separately.

## Backend work still required

The room server must authenticate host operations, retain valid-PIN joiners in a pending state when manual approval is on, and admit them only on approval. Decline removes the pending request. Leaving, disconnects, room capacity, and stale decisions need authoritative handling. The preview blocks turning off approval while requests are pending so the setting cannot accidentally bypass those decisions.

Per-person permission checks must run before forwarding transfers over **both local and relay paths**, including direct and voice sends. Hiding a control in the renderer does not enforce permission. Broadcast room policy changes and synchronize policy before switching paths. Pending-request details should be sent only to the host.

The preview simulates host decisions and exposes `previewControls.canShare(deviceId)` for policy checks. It does not send real tabs/files or implement a remote applicant's waiting screen. `joinRoom()` in this single-browser preview opens an independent demonstration member room, not a live connection to the host preview.

## Layout behavior

The user reverted the single-row restriction. Layouts support rows, columns, and grids again. Dropping onto an occupied laptop swaps their exact positions; dropping into empty space snaps to the nearest free edge. Saved positions cannot overlap. Incoming layout coordinates are preserved.

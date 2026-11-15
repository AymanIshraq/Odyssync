# Combined 0.1.4 and file sharing candidate

Local branch: `combined-0.1.4-file-sharing`.

Fetched from `https://github.com/AymanIshraq/Odyssync` on November 15, 2026:

- Base: `main`, `6359e46`, verified `app/package.json` version `0.1.4`.
- Features: `integration`, `cee7f27`.
- Merge conflicts resolved locally; no commit, push or release publication.
  The package version remains 0.1.4; this candidate is not the original release binary.

## Preserved behavior and additions

- Browser swipes send the selected URL even from a multi-tab window. Successful
  receipt closes the entire source window, including its other tabs, as requested.
  Rejection, failure and timeout restore the source.
- Immediate sender hiding, separate visibility worker, queued-open expiry,
  blank/new-tab recognition, room timing fixes and Windows packaging remain from main.
- Explorer drops send one regular file, up to 50 MiB, to Downloads/Odyssync.
  Existing names are preserved; received copies get unique names. Focus and
  Approval rules apply. Ordinary Explorer drops do not auto-open the file.
- Notepad snapshots include unsaved text. VS Code/Cursor transfer the saved active
  file. Editor projects and Notepad windows with other tabs stay at the sender.
- Received browser, Notepad, VS Code and other supported document windows maximize
  before acknowledgment. Normal Windows maximization is used, not F11 fullscreen.
- Document launches retain integration's longer startup budget and main's
  nonblocking visibility handling. Packaged document launchers use the same DLL
  environment cleanup as packaged browser launchers.
- File senders register before sending, so immediate acknowledgments cannot be lost.
  Failed binary sends clean up the receiver's pending file card.

## Checks completed

- 138 Python tests: `python -m unittest discover -s sidecar/tests`.
- 49 JavaScript tests: `node --test app/main/*.test.cjs app/overlay/*.test.cjs`.
  Includes real loopback relay/local WebSocket transfers in both directions,
  matching binary contents, unique received names, and DIP-to-physical conversion.
- Native Chrome five-tab check: selected tab arrives alone, receiver maximizes,
  all source tabs survive restoration, and source closes after success.
- Native blank selected-tab check passed using a disposable receiver profile.
  The normal-profile check encountered Chrome's profile picker. Both original
  0.1.4 and combined URL inspection rejected that picker. Configure/open a normal
  Chrome profile before testing real blank-tab handoffs on this machine.
- Native Notepad check: captured and received bytes match; receiver opens maximized.
- Native VS Code check: captured saved file matches; receiver opens maximized.
  Its source used a disposable profile with the required title setting; personal
  editor settings were not changed.

Some native Chrome URL reads exceeded the 300 ms target (up to about 865 ms in
these runs). Functional success is not a certification of latency or animation smoothness.

## Setup and remaining acceptance

VS Code/Cursor require this setting, already required by integration:

```json
"window.title": "${dirty}${activeEditorLong}${separator}${rootName}${separator}${profileName}${separator}${appName}"
```

Save the active editor file before swiping. Untitled, dirty or remote editor files
are refused. Full projects are not transferred. See `sidecar/README.md` for details.

Before calling this a stable release, test on both physical laptops:

1. Browser selected-tab, blank-tab and document swipes in both directions, repeatedly.
2. Explorer drag-and-drop onto the real overlay on all four occupied edges.
3. Focus rejection, Approval accept/reject/timeout, disconnect and missing-app recovery.
4. Mixed DPI scaling, click-through, animation smoothness and larger files near the limit.
5. Test the portable/installer outputs on a separate laptop without Node/Python.

The tests above do not certify these two-laptop checks.

## Windows binaries built

Built from this combined working tree on November 15, 2026:

- `dist/windows/Odyssync-0.1.4-portable.exe`: run directly.
- `dist/windows/Odyssync-0.1.4-setup.exe`: per-user installer with shortcuts.

Both retain the 0.1.4 package version but contain the combined branch's code.
The packaged archive was checked for multi-tab, Explorer-drop and document handoff
implementation. The frozen helper's dependency self-test and three packaging tests
passed. `node tools/smoke-windows.cjs` successfully launched the portable EXE,
loaded its Control Center/preload, hosted a temporary relay room, accepted a test
peer and verified the bundled helper process, with Node/Python removed from PATH.
The test left the room and closed the app. The setup installer was built but was
not installed over the user's existing app. These local binaries are unsigned.

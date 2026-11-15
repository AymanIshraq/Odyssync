# Moving-box overlay spike

Standalone Windows Electron experiment. No shared app entry point, preload,
transport, or later overlay features are used.

From the repository root in PowerShell:

```powershell
npm.cmd --prefix tools/spikes/overlay ci
npm.cmd --prefix tools/spikes/overlay run check
npm.cmd --prefix tools/spikes/overlay start
```

Stop from any app with **Ctrl+Alt+Shift+Q**. Startup refuses to show the
overlay if that shortcut cannot be registered. It also quits after five
minutes, on a renderer crash/hang, or when its window closes. Ctrl+C in the
launch terminal is another option. If necessary, use the printed Electron
main-process PID in `taskkill /PID <pid> /T /F`; do not kill unrelated Electron apps.

## Manual acceptance checks

1. Before launch, open Chrome on a long page and Explorer in a folder with
   enough items to scroll. Keep a text field or address bar focused while
   launching; verify launch does not take keyboard focus.
2. In Chrome, click links and fields, scroll with the wheel and touchpad,
   and type in a field/address bar. Repeat while the colored box covers the
   pointer/field, and beneath the FPS panel. Input must reach Chrome.
3. In Explorer, select folders/files, double-click a folder, scroll its item
   list, and type a harmless query in Search or a path in the address bar.
   Repeat through the colored box. Avoid renaming/deleting files for this test.
4. Raise/maximize each app and switch between them. The box must remain above
   both. Reveal the taskbar (hover its edge if auto-hidden) and click Start or
   a pinned app. The taskbar must receive the click while the box remains
   visibly above it. The box reaches the bottom at about 3 seconds after
   launch and every 13 seconds thereafter; check the taskbar during those passes.
   If fullscreen suppresses the taskbar so this cannot be observed, record
   that as an unresolved check, not a pass.
5. Watch the FPS readout for at least 30 seconds during input and app switching.
   Target roughly 60 FPS on a 60 Hz display; higher refresh displays may show
   higher values. This measures rAF callbacks per second, not compositor
   presentation or input latency. Record sustained drops and visible stutter.
6. Press Ctrl+Alt+Shift+Q while Chrome/Explorer is focused: overlay disappears
   and the launch command exits. Relaunch and verify the five-minute timeout.
   Repeat acceptance on a second laptop with different display scaling.

Only one box moves, using `transform` in one requestAnimationFrame chain;
the FPS label updates once per second. The transparent window is deliberately
always drawing for this experiment. Production idle behavior (E3.3), handoff,
ghosts, approvals, voice, and file transfers are outside this spike.

## Verification status

See the implementation report for checks executed in the development session.
Windows click-through, focus retention, taskbar stacking, sustained 60 FPS,
stop shortcut, timeout, and two-laptop/DPI acceptance require live observation;
source inspection alone does not establish those passes.

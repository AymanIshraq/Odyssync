# Tech 1 — Python helper (`sidecar/win32_daemon.py`)

You own everything that touches Windows. Messages and units: `contract.md`,
section "Sidecar loopback". You speak physical pixels only.

Libraries: `pywin32`, `uiautomation`, `Pillow`, `mss`, `websockets`.
First line of `main`: make the process per-monitor DPI aware
(`ctypes.windll.shcore.SetProcessDpiAwareness(2)`).

## Hour 16 to 15: spike

`tools/spikes/url_read.py`: while the left button is held on a Chrome window,
print its URL and tab count. Pass = correct URL printed within 300 ms of the
drag starting, on a normal page, a page with no `https://` shown, and a new
tab page. If this fails, tell everyone immediately: it is the riskiest step.

## Item 1 — sender side (hours 15 to 12)  → E4.1, E4.2, E4.8, E4.9

1. Connect to `ws://127.0.0.1:8089`, send `SIDECAR_READY`, reconnect forever.
2. Poll loop every 16 ms: left button state, foreground `hwnd`, class name, rect.
3. Drag = button held + class `Chrome_WidgetWin_1` + rect changed between frames.
4. On drag start, on a **worker thread**: read tab count (`TabItemControl`s)
   and URL (address bar `EditControl` with `ValuePattern`; try by name, then
   first match). Add `https://` if there is no scheme. Work out `browser` from
   the process name. Send `LOCAL_DRAG_START` only if one tab and a URL.
5. Keep `SET_ACTIVE_EDGES`. When the window or cursor is within 120 px of an
   active edge for the first time in this drag: snapshot with
   `PrintWindow(hwnd, hdc, 2)`; if the image is mostly black, grab the window
   rect with `mss`. Resize to max 800 px wide, JPEG q75, send `LOCAL_WINDOW_PREVIEW`.
6. Every frame of the drag send `LOCAL_DRAG_MOVE`. `protrusionPx` = how far the
   window rect extends past that screen edge (0 if none). `centerRatio` = the
   window centre along the edge, 0..1. `cursorAtEdge` = cursor within 4 px.
7. On button up send `LOCAL_DRAG_END`.

## Item 2 — window commands and receiver side (hours 12 to 10)  → E4.4, E4.5, E4.6

1. `HIDE_WINDOW` (`ShowWindow(hwnd, SW_HIDE)`), `SHOW_WINDOW` (show and move
   fully on-screen), `CLOSE_WINDOW` (`PostMessage WM_CLOSE`).
2. `OPEN_URL`: record all top-level `Chrome_WidgetWin_1` handles; launch
   `<browser exe> --new-window <url>` (find the exe via the registry App Paths;
   fall back to `os.startfile(url)`); poll up to 4 s for a new visible handle;
   `SetWindowPos` to the given rect; send `WINDOW_PLACED`. Otherwise `OPEN_FAILED`.
3. Never raise out of the loop: log and carry on.

## Hours 10 to 6: integrate with everyone

All four edges (E4.7), twenty in a row (E4.12).

## Voice assistant

If you are free before Tech 2 after the first handoff works, you build
`voice.md`. Either way you add `GET_ACTIVE_TAB` and `GET_SELECTED_FILE`
(see `voice.md`, step 5).

## Item 3 — Focus bounce (after hour 6)  → E5.3

`BOUNCE_WINDOW`: animate the real window back 180 px inside the screen over
~300 ms with `SetWindowPos`.

## Item 4 — file drag detection  → E6.1

While the button is held, foreground class in `CabinetWClass`, `Progman`,
`WorkerW`, and the cursor within 100 px of an active edge: send
`LOCAL_FILE_DRAG {active: true, edge}`; send `active: false` on release or
when the cursor leaves.

## Done when

Your checks in `feature_expectation.md` pass on two different laptops, one of
them at 125% or 150% display scaling.

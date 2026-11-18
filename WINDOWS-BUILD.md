# Windows executable builds

End users can run `Odyssync-0.1.4-portable.exe` directly, or use
`Odyssync-0.1.4-setup.exe` for a per-user installation and shortcuts.
Both contain Electron, Node, Python and the Windows helper's dependencies.
Chrome, Edge or Brave must already be installed. The existing relay URL is
included from `app/config.json`; no cloud service is installed on the laptop.

## Build on Windows x64

Only the build computer needs Node.js and 64-bit Python 3.11+.
From the repository root in Command Prompt:

```cmd
npm --prefix app ci
npm --prefix app run dist:win
```

The build uses `.venv\Scripts\python.exe` if present, otherwise `python`
from PATH. It installs `sidecar/requirements-build.txt`, freezes the helper
with PyInstaller, and packages the app with electron-builder.
The frozen helper also runs a read-only smoke test with Python and Node
directories removed from PATH: Win32, UI Automation/COM, monitors, JPEG and
WebSocket imports must work before Electron is packaged. Build outputs
are ignored by Git under `build/` and `dist/`. To reproduce a build, retain
the committed npm lockfile. Python runtime requirements retain their existing
version ranges; the build tool itself is pinned.

Distribute the two top-level EXE files in `dist/windows/`. The supporting
`win-unpacked/` and `dist/sidecar/` folders are build outputs, not files an
end user must copy alongside the portable EXE. The portable launcher extracts
the app to a temporary folder when started.

## Verification

```cmd
npm --prefix app run test:packaging
node tools/smoke-windows.cjs
```

Close all Odyssync copies before the smoke test. It starts the portable EXE
with Python and Node removed from PATH, checks the real Control Center and
preload, creates a temporary room, joins it through the relay with a test
peer, verifies that the extracted helper EXE is running, then leaves and quits.
It needs internet and uses localhost port 9339 for its temporary renderer
diagnostics. That diagnostic port is not enabled in normal launches.

On a Windows laptop without Node or Python, open the portable EXE, create or
join a relay room, and hand off a single-tab Chrome window in both directions.
Check rejection and timeout restoration before distributing to the team.
Close the source app before opening a packaged build: both use port 8089.
These local builds are unsigned, so Windows may show an unknown-publisher
warning. Signing can be added later with the owner's certificate.

The source workflow (`npm --prefix app start`) continues to work. In a packaged
build, the bridge starts `resources/sidecar/odyssync-sidecar.exe` directly,
outside `app.asar`. It never falls back to an installed Python interpreter.
When the frozen helper starts an installed browser, it temporarily restores
normal Windows DLL search paths so its bundled DLLs do not affect Chrome.
No network messages or renderer APIs are changed by packaging.

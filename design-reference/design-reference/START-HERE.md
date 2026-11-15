# Continue in VS Code

1. Extract this package into a new `design-reference` folder inside your local Odyssync clone.
2. Open Codex in VS Code.
3. Send: "Read plan/contract.md before every response. Read design-reference/design.md and plan/ui2-overlay.md. Implement only the moving-box spike described in the handoff."
4. Review local changes before committing.

## Contents

- design.md: approved visual direction, requested behavior, contract boundaries and next task.
- images/: one screenshot of the original Figma Make preview, plus nine screenshots of the local restored UI.
- assets/: original favicon and locally generated PWA install icons.
- source-reference/: editable React/CSS reference files. These are not a complete Electron app.

The images are screenshots, not editable .fig files. The original ZIP's laptop artwork is implemented in CSS; its code is included for reuse.

No overlay spike has been implemented in this chat. No native click-through, taskbar or two-laptop checks have passed here. The next Codex session should implement and verify that spike.

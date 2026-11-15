# Voice assistant — "Hey Odyssync"

Owner: whichever tech person finishes their handoff work first, starting after
the first real handoff works (10 hours left). It comes before file transfer and
kick on that person's list.

The user says "Hey Odyssync" (or presses the hotkey), talks, and Odyssync
answers in an ElevenLabs voice and carries out the request.

## Before writing code (30 minutes)

Check the current ElevenLabs docs for their voice-agent product and its
JavaScript client: how a session is started from a browser page, and how
"client tools" (functions the agent can call in the app) are declared. The
steps below were written from memory of that product; adjust names to match.

## Setup (once, shared by the team)

1. ElevenLabs account. Create one agent:
   - Prompt: "You are Odyssync, a short-spoken assistant inside a screen
     sharing app. Use the tools to send tabs and files between people in the
     room and to change the user's mode. Call list_members before sending if
     you are unsure who is meant. If a tool returns an error, say it in one
     sentence. Never claim something was sent unless the tool said so."
   - Four client tools, exactly as in the table below.
   - Pick a voice. Keep replies to one or two sentences.
2. Put the agent ID in `app/config.json`. A public agent needs no key in the
   app; this is the hackathon choice.
3. Picovoice account: train the phrase "Hey Odyssync" for the Web platform,
   download the keyword file, put the access key in `app/config.json`.
4. Windows: Settings > Privacy > Microphone: allow desktop apps.

## Tools the agent can call

| Tool | Arguments | Returns |
|---|---|---|
| `list_members` | none | `[{ name, mode, isMe }]` |
| `send_current_tab` | `targetName` | `{ ok, sentTo?, error? }` |
| `send_selected_file` | `targetName` | `{ ok, sentTo?, filename?, error? }` |
| `set_mode` | `mode` | `{ ok }` |

Errors are plain sentences the agent can read out: "Rafi is in Focus mode",
"No browser tab is open", "No file is selected in File Explorer", "Two people
match that name: Rafi A and Rafi K".

## Build steps

1. **Voice window** (`app/voice/`): a hidden Electron window that owns the
   microphone and the ElevenLabs session. In `main/index.js` allow the `media`
   permission for it.
2. **Hotkey**: `Ctrl+Alt+Space` via `globalShortcut`. Press starts a session;
   press again, or 8 s of silence after the agent finishes, ends it. (A global
   hotkey cannot detect key release, so it is press-to-start, not hold-to-talk.)  → E8.1
3. **Session**: start the ElevenLabs session with the agent ID and the four
   tools, each calling `window.odyssync.voice.*` (see `contract.md`).  → E8.2
4. **In `main/room.js`**:
   - `send_current_tab`: ask the helper `GET_ACTIVE_TAB`; resolve the name to
     one member (case-insensitive, prefix match); refuse if the target is in
     Focus; send `TRANSFER_COMMIT {kind: "tab", direct: true}`. A single-tab
     window is moved (hide, then close on accept). A window with several tabs
     is **copied**: the tab stays here too, and the tool says so.  → E8.3
   - `set_mode`, `list_members`: straight from room state.  → E8.4, E8.5
   - `send_selected_file`: ask the helper `GET_SELECTED_FILE`, then the normal
     file transfer. **Needs file transfer (Tech 2, item 3) to exist first.**  → E8.6
5. **Helper (Tech 1)**: remember the last foreground browser window and the
   last foreground Explorer window. `GET_ACTIVE_TAB` reads URL, title and tab
   count as in a drag. `GET_SELECTED_FILE` reads the selection through
   `Shell.Application` (`win32com`).
6. **Overlay (UI 2)**: a small indicator for `VOICE {state}` (listening,
   thinking, speaking). A `COMMIT` that arrives with no drag before it slides
   the card in from the edge facing the sender, or the nearest edge.
7. **Wake phrase**: Porcupine's web library in the voice window, listening
   locally for "Hey Odyssync"; on detection, start the session as the hotkey
   does. A toggle in the Control Center turns the wake phrase off.  → E8.7
8. No internet or no microphone: the hotkey shows a notice and does nothing else.  → E8.8

## Order

Steps 1 to 4 with tab, mode and members first (works without file transfer),
then 6, then 7, then the file tool once file transfer exists.

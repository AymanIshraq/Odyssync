# Voice window (hidden)

`index.html` + `voice.js` run in a hidden window (preload: `main/preload-voice.js`).
They listen for "Hey Odyssync" (Picovoice Porcupine) or the voice hotkey, then talk to an
ElevenLabs agent. The agent's "brain" is a Groq model. Without keys nothing breaks:
the hotkey shows "Voice is not set up yet", and the wake word stays off.

Libraries load as plain scripts straight from `node_modules` (no build step):
`@elevenlabs/client@1.33.0` (`dist/lib.iife.js`), `@picovoice/web-voice-processor@4.0.10`,
`@picovoice/porcupine-web@4.0.1` (`dist/iife/index.min.js`).

## 1. Groq (free LLM key)

1. Sign up at https://console.groq.com and create an API key (`gsk_...`).
2. Model to use: `openai/gpt-oss-120b` (tool calling; `llama-3.3-70b-versatile` also works).

## 2. ElevenLabs agent

1. https://elevenlabs.io/app/agents -> Create agent (blank).
2. **LLM**: choose **Custom LLM**.
   - Server URL: `https://api.groq.com/openai/v1`
   - Model ID: `openai/gpt-oss-120b`
   - API key: add a **secret** (e.g. `groq_key`) holding the Groq key and pick it.
3. **First message**: `Hi, what should I send?` (or leave empty).
4. **System prompt**: paste the PROMPT below.
5. **Tools** -> Add tool -> type **Client**, tick **Wait for response** on each. Names must match exactly.
6. **Security**: keep the agent public (no auth) - the app starts it with only the agent ID.
7. **Advanced -> client events**: make sure `user_transcript`, `agent_response` and `vad_score`
   are enabled (used for the "thinking" state and the 8-second quiet timeout).
8. Copy the **agent ID** (`agent_...`) into the app's voice config.

### Client tools

| Name | Description | Parameters |
|---|---|---|
| `list_members` | Lists the people in the room and the current mode. | none |
| `set_mode` | Changes the room mode. | `mode` (string, required): `collaborative`, `approval` or `focus` |
| `send_current` | Sends the current thing (the active tab, window or file) to someone. | `targetName` (string, optional): person to send to |
| `show_send_menu` | Shows a numbered list on screen of what can be sent. | `targetName` (string, optional) |
| `send_items` | Sends items from the on-screen menu by their numbers. | `numbers` (array of numbers, required), `targetName` (string, optional) |

Each tool returns JSON (for example `{"ok":true,...}` or `{"ok":false,"error":"..."}`).

### PROMPT

```
You are Odyssync, a voice helper inside a desktop app that moves tabs, windows and files
between people in a room. Talk like Siri: one short sentence per reply, friendly, no lists,
no markdown, no emojis.

Tools:
- "send this", "send the tab", "send the file", "send it to Sam" -> call send_current
  (pass targetName when a person is named).
- "show me what I can send", "what can I send" -> call show_send_menu. The screen then shows
  a numbered list.
- Numbers the user says ("send 2 and 4", "the first one") refer to that list -> call send_items
  with those numbers (and targetName if named).
- "who's here", "who is in the room" -> list_members.
- "switch to approval/focus/collaborative mode" -> set_mode.

Rules:
- If send_current returns needTarget, ask who to send it to and say they can also pick the
  person in the picker on screen.
- Never say something was sent or changed unless the tool returned ok:true.
- If a tool returns an error, read it back in one short sentence.
- If you don't know a person's name, call list_members first.
- When the user is done ("thanks", "that's all"), say a short goodbye.
```

## 3. Wake word (Picovoice)

1. Sign up at https://console.picovoice.ai and copy the **AccessKey** into the app's voice config.
2. Porcupine -> train wake word `Hey Odyssync`, language English, platform **Web (WASM)**.
   Download, unzip, and save the `.ppn` as `app/voice/hey-odyssync.ppn`.
3. Download the English model params `porcupine_params.pv` (from the Porcupine GitHub repo,
   `lib/common/porcupine_params.pv`) and save it as `app/voice/porcupine_params.pv`.
   The `.ppn` and `.pv` must be the same Porcupine version (v4).

## 4. Microphone

- Windows: Settings -> Privacy & security -> Microphone -> turn on "Microphone access" and
  "Let desktop apps access your microphone".
- macOS: System Settings -> Privacy & Security -> Microphone -> allow Odyssync (or Electron when run with `npm start`).

Messages the user may see: "Microphone is not available", "Voice needs an internet connection",
"Voice is not set up yet: add the ElevenLabs agent ID".

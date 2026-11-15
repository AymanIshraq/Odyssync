# Odyssync — Build Plan

Approved 2026-11-14 with 16 hours left. Read `memory-bank/project-brief.md` and
`memory-bank/architecture.md` first. `contract.md` in this folder is the
agreement between the four tracks: **do not change it without telling everyone.**

| File | For |
|---|---|
| `contract.md` | Everyone. Message shapes, units, IDs, folder layout. |
| `tech1-sidecar.md` | Tech 1: the Python helper |
| `tech2-room-transport.md` | Tech 2: room server, relay, transport, bridge to the helper |
| `ui1-control-center.md` | UI 1: launch, join, canvas, modes, roster |
| `ui2-overlay.md` | UI 2: overlay, ghost, animations |
| `voice.md` | The "Hey Odyssync" voice assistant: first tech person free after the first handoff |

## Rules

1. Tab handoff first on every track. Do not start item 2 of your list while
   item 1 is unfinished.
2. When the handoff is ready to integrate (10 hours left), everyone integrates.
3. Each task names the checks it must pass in `memory-bank/feature_expectation.md`.
4. After finishing a component, update `memory-bank/progress.md`.
5. Feature freeze with 2 hours left.
6. Commit small and often to one shared branch; pull before you start a task.

## Setup on every laptop (first hour)

- Windows 10/11, Chrome installed, signed in to nothing special.
- Node 20+, Python 3.11+ on PATH.
- `cd app && npm install`
- `cd sidecar && pip install -r requirements.txt`
- Settings > System > Multitasking > Snap windows: **Off**.
- Power: plugged in, sleep disabled.
- First run on the host: accept the Windows Firewall prompt for private networks.
- Accounts, one person, first hour: a Railway or Render account for the relay,
  an ElevenLabs account, a Picovoice account (see `voice.md`).

## Milestones (hours left)

| Hours left | Milestone |
|---|---|
| 16 to 15 | Contract read by all four, repo created, setup done, two spikes |
| 15 to 10 | Item 1 on every track |
| 10 to 8 | First real handoff between two laptops on the hotspot |
| 8 to 6 | Four laptops, all edges, failure path, one remote laptop |
| 6 to 2 | The rest of each list, including the voice assistant |
| 2 to 0 | Freeze, rehearsal, checklist |

## Demo checklist (fill in during rehearsal)

- [ ] Snap off on all laptops
- [ ] Relay URL reachable; direct-IP join tested with internet off
- [ ] Firewall prompt accepted on the host
- [ ] Demo pages chosen (look the same when reopened, no login needed)
- [ ] Twenty handoffs in a row pass
- [ ] Microphone allowed on each laptop; ElevenLabs agent ID and Picovoice key in `app/config.json`
- [ ] Voice commands tried in the real room noise; wake phrase switched off if it misfires

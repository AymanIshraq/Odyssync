# UI1 explained: what you need to do

Your job is to build the Control Center in `app/control/`. This is the app window where people join a room, see the other laptops, and arrange them to match their positions on the desk.

The host is the person who creates the room. Everyone who joins is a member.

## How your UI connects to the app

Use `window.odyssync` for app actions and updates. Tech 2 builds this connection. You build the screens and buttons that use it. Read the "Renderer API" section of `plan/contract.md` for the exact calls.

Tech 2 will give you a stub: a fake version of the API. Use that to build and check your screens before the real connection is ready.

## 1. Set up the laptops (hours 16 to 15)

Install Node, Python, and Chrome on all four laptops. Turn off Windows Snap, which automatically moves windows to screen edges. Check that the hotspot works. Follow the Setup instructions in `README.md`.

The hours in the original plan count down toward the deadline.

## 2. Build the start and join screens (hours 15 to 10)

Start with a name field already filled with the laptop's name. Under it, show **Create a Room** and **Join a Room**.

- **Create:** call `odyssync.createRoom(displayName)`.
- **Join:** show six boxes for the room number and four for the PIN. Call `odyssync.joinRoom({ roomNumber, pin, displayName, directIp? })`; include `directIp` only when using an IP address.
- Add an **Offline / Direct IP** link. Clicking it replaces the room number boxes with an IP address field.
- If joining fails, show the returned `reason`. Keep the join screen open so the user can try again.

Checks from the original plan: E1.1 and E1.3.

## 3. Build the room screen (also hours 15 to 10)

At the top, show the room number, PIN, local IP addresses, and a **Copy Invite** button. Show **Leave** for members and **End Room** for the host. Use `odyssync.leaveRoom()` for leaving.

Below that, draw a card for every laptop in `screens`. Each card represents a laptop screen. Use a 16:9 shape, size it using its `w` and `h`, and show its name and number badge.

Only the host can drag these cards. When a card is released, it must snap to the nearest free edge of another card, with the edges touching exactly. Then call `odyssync.setLayout(screens)` with the updated layout.

For example, if four laptops sit side by side on the desk, the host should be able to arrange four cards in a row. A 2x2 square must also work. Members see changes live but cannot drag cards.

Use `odyssync.onState(callback)` to receive the current room information and update what the screen shows. Use `odyssync.onNotice(callback)` to handle notices: if the user is kicked or the room closes, return to the start screen and show the notice text.

Checks: E1.2, E2.1-E2.3, and E1.5.

## 4. Connect with the other team's work (hours 10 to 6)

Work with Tech 2 to replace the fake API with the real one. Check that creating, joining, leaving, and changing the layout work across laptops.

## 5. Add mode controls and a member list (after hour 6)

At the top, add three mode choices: **Collaborative**, **Approval**, and **Focus**. Call `odyssync.setMode(mode)` when the user chooses one. The API values are `collaborative`, `approval`, and `focus`. Show each laptop's current mode on its card.

Add a sidebar listing everyone in the room. For each person, show:

- Name.
- Current mode.
- Connection type: **Local** or **Relay**.
- Ping: the connection's response time.

The host also sees a red **Kick** button next to other members. Call `odyssync.kick(deviceId)` when clicked. Never show a Kick button for the host.

Animate cards when a laptop joins, leaves, or snaps into position.

Checks: E5.2, E6.3, E6.4, E7.7, and E5.6.

## 6. Add direct sending

Put a **Send to** button on each laptop card. It calls `odyssync.sendDirect(deviceId)` to send the last active browser tab to that laptop.

If the target laptop is in Focus mode, show **Focus Locked** and shake the card instead of sending.

Check: E6.2.

## How it should look

Use a dark background with glass-style panels. The mode colours are cyan `#00F0FF`, amber `#FFB800`, and red `#FF2A54`.

## How to know you are finished

Try the features above with four real laptops in the same room. Confirm that both a row of four and a 2x2 layout work, members see live updates, host-only controls stay restricted to the host, and sending to a Focus laptop is blocked.

Start with the name field and Create/Join screens. Then build the room screen and draggable cards. Follow the remaining steps in order.

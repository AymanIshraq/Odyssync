# Odyssync code, explained for someone with no tech knowledge

This file walks through every line of code written so far for Tech 2, in plain words.
File 1 (downloading the libraries and making the folders) is left out.

| # | File | One-sentence job |
|---|---|---|
| 2 | `app/main/index.js` | Turns the app on and builds the two windows |
| 2 | `app/control/index.html` | A "hello" page inside the Control Center window |
| 2 | `app/overlay/index.html` | A "hello" label on the see-through glass window |
| 3 | `app/main/preload-control.js` | A **toy remote control** for the Control Center, full of pretend data |
| 4 | `app/main/preload-overlay.js` | The **real** remote control for the glass window |
| 5 | `tools/replay.js` + `tools/fake-drag.json` | A **movie player** that shows the glass window a pretend drag, on repeat |
| 6 | `app/main/sidecar-bridge.js` | A **listening post** that writes down what Tech 1's Python helper says |
| 7 | `app/server/server.js` | The **front desk**: checks the PIN, keeps the guest list, passes notes between laptops |
| 8 | `app/main/transport.js` | The **mail carrier** in each laptop: sends notes on the right line and throws away repeats |
| 9 | `app/main/room.js` | The **seating chart**: rooms, the guest list, where screens sit, who is next to whom, modes |
| 10 | `app/main/sidecar-bridge.js` (full) | The **robot phone**: starts Tech 1's Python helper, passes its messages on, sends it commands |
| 11 | `app/main/handoff.js` | The **traffic lights**: every rule for handing a window to a neighbour without losing it |

---

## Little dictionary (read this first) 📖

| Word | What it means |
|---|---|
| **Code** | Instructions written for the computer, one step per line. The computer reads top to bottom. |
| **File** | One page of instructions. Each file has one job. |
| **JavaScript** | The language these files are written in. |
| **Electron** | A toolbox that lets us build desktop apps (windows you can open on Windows or Mac) using web-page tools. |
| **Window** | A box on your screen, like the Chrome window or a Word window. |
| **Page (HTML)** | What is drawn *inside* a window: text, buttons, pictures. |
| **Comment** | A line starting with `//` (or `<!-- ... -->` in HTML). The computer **ignores** it. It's a sticky note for humans. |
| **Variable** | A labelled box that holds something. `let box = 5` puts 5 in a box called `box`. |
| **`const`** | A labelled box whose label can't be moved to something else later. |
| **`let`** | A labelled box whose contents *can* be swapped later. |
| **`null`** | "Empty, nothing here yet." |
| **Function** | A recipe with a name. You write it once and "call" it (use it) whenever you want. |
| **`=>`** | A short way to write a recipe. `(x) => x + 1` means "give me x, I give back x + 1". |
| **Object `{ }`** | A form with labelled fields, like `{ name: 'Rafi', age: 20 }`. |
| **List `[ ]`** | A row of things in order, like `['Me', 'Rafi', 'Sara']`. |
| **`require(...)`** | "Borrow this toolbox." |
| **Main part** | The hidden "brain" of the app. It builds windows and will later talk to other laptops. |
| **Page part** | What runs *inside* a window (the screens UI 1 and UI 2 build). |
| **Preload** | A small helper that runs *between* the brain and a page. It's the only safe door between them, and it hands the page a remote control called `window.odyssync`. |
| **DIP** | A screen measurement that stays the same size even if Windows zooms the screen to 125% or 150%. |

---

# File 2a: `app/main/index.js`, the "turn on" button 🔌

**Its job:** when you start Odyssync, this file runs first and builds two windows:
1. 🖥️ the **Control Center**, a normal window with buttons (create room, join room…)
2. 🪟 the **overlay**, an invisible sheet of glass over your whole screen, where the sliding window pictures appear

```js
// Electron entry: creates the Control Center window and the overlay window.
```
A sticky note for humans: "This is where the app starts. It makes the two windows."

```js
const path = require('path');
```
Borrow the **"addresses" toolbox** 🗺️. It helps us write where files live on the computer (folder → folder → file) in a way that works on both Windows and Mac.

```js
const { app, BrowserWindow, screen } = require('electron');
```
Borrow three tools from the Electron toolbox:
- `app` = the whole app (start it, stop it, know when it's ready)
- `BrowserWindow` = the **window-maker**
- `screen` = a **ruler** that measures your screen

```js
let controlWin = null;
let overlayWin = null;
```
Two empty boxes with name tags. Soon each one will hold a window, so other parts of the app can find them. `null` = empty for now.

### Making the Control Center window

```js
function createControlWindow() {
```
Start of a recipe called "make the Control Center window".

```js
  controlWin = new BrowserWindow({
```
"Window-maker, make a **new** window, and put it in the `controlWin` box." The settings come next:

```js
    width: 1100,
    height: 750,
```
Make it 1100 dots wide and 750 dots tall.

```js
    title: 'Odyssync',
```
The name shown at the top of the window.

```js
    webPreferences: { preload: path.join(__dirname, 'preload-control.js') },
```
"Before showing the page, load this helper first." The helper is `preload-control.js` (file 3), the remote control. `__dirname` means "the folder this file is in", and `path.join` glues the folder and the file name into a full address.

```js
  });
```
End of the settings. Make the window.

```js
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'index.html'));
```
"Put this page inside the window." `'..'` means "go up one folder", so the address is `app/control/index.html`, the placeholder page that UI 1 will replace.

```js
  // Closing the Control Center quits the app (the overlay cannot be closed by hand).
  controlWin.on('closed', () => app.quit());
```
"When someone **closes** this window, turn the whole app off." The glass window has no close button, so this is how you quit.

```js
}
```
End of the recipe.

### Making the glass (overlay) window

```js
function createOverlayWindow() {
```
Start of a recipe called "make the glass window".

```js
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
```
Use the ruler 📏 to measure your **main screen**: where it starts (`x`, `y`) and how wide and tall it is. We keep those four numbers.

```js
  overlayWin = new BrowserWindow({
    x, y, width, height,
```
Make a new window, put it in the `overlayWin` box, and make it **exactly the size of your screen**.

```js
    transparent: true,
```
Made of **clear glass**: you can see through it.

```js
    frame: false,
```
No border, no title bar, no close/minimise buttons.

```js
    // Windows uses true fullscreen (flags from plan/ui2-overlay.md). On a Mac,
    // fullscreen would open a separate Space, so we just cover the display.
    fullscreen: process.platform === 'win32',
```
`process.platform === 'win32'` asks "are we on Windows?". If **yes**, use real fullscreen. If **no** (a Mac), don't, because a Mac would move a fullscreen window onto its own separate desktop. The window already covers the screen anyway.

```js
    skipTaskbar: true,
```
Don't show it in the taskbar at the bottom of the screen, so nobody can click on it there.

```js
    focusable: false,
```
It can never "steal" your typing. Your keyboard keeps going to whatever app you're using.

```js
    hasShadow: false,
```
No shadow around it (a shadow would give away that it's there).

```js
    resizable: false,
```
Nobody can stretch or shrink it.

```js
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js') },
```
Load the glass window's helper first: `preload-overlay.js` (file 4).

```js
  });
```
End of settings. Make the window.

```js
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
```
Keep it **on top of everything**, even the taskbar, like a sticker on your screen. `'screen-saver'` is the highest "on top" level there is.

```js
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through
```
👻 **Ghost mode.** Your mouse clicks go **through** the glass to the app underneath, as if the glass isn't there. `forward: true` still lets the glass *know* where the mouse is, for later effects.

```js
  overlayWin.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
```
Put the page `app/overlay/index.html` inside the glass. It's the placeholder that UI 2 will replace with the animations.

```js
}
```
End of the recipe.

### Starting up and shutting down

```js
app.whenReady().then(() => {
  createControlWindow();
  createOverlayWindow();
});
```
"When the app has **woken up**, follow both recipes": first make the Control Center, then the glass.

```js
app.on('window-all-closed', () => app.quit());
```
"If every window is gone, turn the app off." It's a second safety switch for quitting.

```js
module.exports = {
  getControlWindow: () => controlWin,
  getOverlayWindow: () => overlayWin,
};
```
"Here's how **other files** can find the windows." Later, `room.js` will ask "where's the glass window?" so it can tell it "show a picture sliding in from the left!". This is the signpost to the two boxes.

---

# File 2b: `app/control/index.html`, the Control Center's hello page

```html
<!doctype html>
```
"This is a web page." It's always the first line of a page.

```html
<html>
```
Start of the page.

```html
<head><meta charset="utf-8"><title>Odyssync</title></head>
```
The page's **label section** (not shown on screen):
- `charset="utf-8"` = "use the alphabet that has every language's letters"
- `<title>` = the name of the page

```html
<body style="font-family: sans-serif; padding: 24px;">
```
Start of what you **see**. `style` = how it looks: a clean letter shape (sans-serif) and 24 dots of empty space around the edges.

```html
  <h1>Odyssync Control Center</h1>
```
A big heading.

```html
  <p>Placeholder page. UI 1 replaces this file.</p>
```
A normal sentence (`<p>` = paragraph) saying this page is temporary.

```html
</body>
</html>
```
End of what you see, and end of the page.

---

# File 2c: `app/overlay/index.html`, the glass window's hello label

```html
<!doctype html>
<html>
<head><meta charset="utf-8"></head>
```
Same start as before: "this is a page", use every language's letters.

```html
<body style="margin: 0; background: transparent; overflow: hidden;">
```
What you see on the glass:
- `margin: 0` = no gaps at the edges
- `background: transparent` = **see-through background** (so the glass stays invisible)
- `overflow: hidden` = never show scroll bars

```html
  <!-- Placeholder page. UI 2 replaces this file. The label proves the overlay is on top. -->
```
A sticky note for humans (HTML style).

```html
  <div style="position: fixed; right: 12px; bottom: 60px; padding: 6px 10px;
              font: 12px sans-serif; color: #fff; background: rgba(0,0,0,0.6);
              border-radius: 6px;">Odyssync overlay (placeholder)</div>
```
One small **label** (`<div>` = a box):
- `position: fixed; right: 12px; bottom: 60px` = pin it near the bottom-right corner
- `padding` = a little space inside the box
- `font: 12px` = small letters, `color: #fff` = white letters
- `background: rgba(0,0,0,0.6)` = a dark background that's a bit see-through
- `border-radius: 6px` = rounded corners

Its only purpose is to prove the glass is really on top of everything.

```html
</body>
</html>
```
End.

---

# File 3: `app/main/preload-control.js`, the Control Center's toy remote 🎮

> ⚠️ **Replaced in file 9.** This toy version no longer exists in the code. It is kept here because it shows what each button is *for*. The real version is explained at the end of the File 9 section.

**Its job:** UI 1 is building the Control Center *right now*, but the real room system (talking to other laptops) isn't built yet. So this file hands the page a **toy remote** with exactly the same buttons as the real one. The buttons only **pretend**, using made-up friends and a made-up room. Later (file 9), the insides get swapped for the real thing, and the buttons keep the same names.

```js
// STUB of window.odyssync for the Control Center (contract.md, "Renderer API").
// Returns fake data so UI 1 can build screens now. File 9 (room.js) replaces the
// insides with real IPC calls; the names and shapes below must stay the same.
```
Sticky notes: "This is a pretend version (a *stub*). The button names must match `contract.md`, the team's shared agreement."

```js
const { contextBridge } = require('electron');
```
Borrow the **`contextBridge`**, the safe little door 🚪 between the hidden brain and the page. Only things passed through this door reach the page.

### The pretend people and screens

```js
const SELF = 'a1b2c3d4';
```
A box holding **"my" ID**, a made-up 8-letter name tag for this laptop.

```js
const W = 1920, H = 1080; // DIPs
```
Two boxes: every fake screen is 1920 wide and 1080 tall (a normal laptop screen).

```js
const FAKE_MEMBERS = [
  { deviceId: SELF,       profile: { displayName: 'Me',     screenWidth: W, screenHeight: H, dpiScale: 1.25 } },
  { deviceId: 'e5f6a7b8', profile: { displayName: 'Rafi',   screenWidth: W, screenHeight: H, dpiScale: 1 } },
  { deviceId: 'c9d0e1f2', profile: { displayName: 'Sara',   screenWidth: W, screenHeight: H, dpiScale: 1.5 } },
  { deviceId: '0a1b2c3d', profile: { displayName: 'Nabila', screenWidth: W, screenHeight: H, dpiScale: 1 } },
];
```
A **list of 4 pretend friends** in the room. Each has:
- `deviceId` = their laptop's name tag
- `displayName` = the name people see
- `screenWidth` / `screenHeight` = their screen size
- `dpiScale` = their Windows zoom (1 = 100%, 1.25 = 125%, 1.5 = 150%). They're different on purpose, so UI 1 sees a realistic mix.

```js
// 2 x 2 grid:  Me | Rafi
//              Sara | Nabila
const FAKE_SCREENS = [
  { deviceId: SELF,       x: 0, y: 0, w: W, h: H },
  { deviceId: 'e5f6a7b8', x: W, y: 0, w: W, h: H },
  { deviceId: 'c9d0e1f2', x: 0, y: H, w: W, h: H },
  { deviceId: '0a1b2c3d', x: W, y: H, w: W, h: H },
];
```
**Where each friend's screen sits** on the shared table, like seats in a classroom 🪑:
- `x` = how far right, `y` = how far down, `w`/`h` = width and height
- Me at the top-left, Rafi to my right, Sara below me, Nabila bottom-right

```js
const FAKE_NEIGHBORS = {
  [SELF]:       { left: null, right: 'e5f6a7b8', top: null, bottom: 'c9d0e1f2' },
  'e5f6a7b8':   { left: SELF, right: null, top: null, bottom: '0a1b2c3d' },
  'c9d0e1f2':   { left: null, right: '0a1b2c3d', top: SELF, bottom: null },
  '0a1b2c3d':   { left: 'c9d0e1f2', right: null, top: 'e5f6a7b8', bottom: null },
};
```
**Who sits next to whom, on each side.** For me: nobody on my left (`null`), Rafi on my right, nobody above, Sara below. So if I drag a window off my **right** edge, it goes to **Rafi**. Each row is one friend's four sides.

### The two pretend "situations"

```js
const EMPTY_STATE = {
  self: FAKE_MEMBERS[0],
  isHost: false,
  roomNumber: null,
  pin: null,
  localIps: [],
  members: [],
  screens: [],
  neighbors: {},
  modes: {},
  transports: {},
  pings: {},
};
```
**Situation 1: "I'm not in any room yet."** A form describing everything the Control Center needs to show:
- `self` = me (the first friend in the list, `[0]` = the first one)
- `isHost` = am I the room's owner? No.
- `roomNumber`, `pin` = empty (`null`), because there's no room
- `localIps` = my laptop's address on the Wi-Fi, an empty list for now
- `members`, `screens`, `neighbors` = nobody, nothing
- `modes` = each friend's mode (collaborative, approval, focus), none yet
- `transports` = how each friend is connected (in the same room, or through the internet), none yet
- `pings` = how fast each friend answers, none yet

```js
const FAKE_ROOM = {
  ...EMPTY_STATE,
```
**Situation 2: "I'm in a room."** `...EMPTY_STATE` means "start by copying everything from situation 1", then change the fields below:

```js
  roomNumber: '482913',
  pin: '1234',
```
Room number 482913, secret PIN 1234.

```js
  localIps: ['192.168.137.1'],
```
A pretend Wi-Fi address for the host laptop.

```js
  members: FAKE_MEMBERS,
  screens: FAKE_SCREENS,
  neighbors: FAKE_NEIGHBORS,
```
Fill in the 4 friends, their seats and their neighbours from above.

```js
  modes: { [SELF]: 'collaborative', 'e5f6a7b8': 'collaborative', 'c9d0e1f2': 'approval', '0a1b2c3d': 'focus' },
```
Each friend's mode: me and Rafi accept windows straight away, Sara must click Accept first, and Nabila is in "do not disturb" (Focus).

```js
  transports: { [SELF]: 'local', 'e5f6a7b8': 'local', 'c9d0e1f2': 'local', '0a1b2c3d': 'relay' },
```
Three friends are in the same room (`local`, the fast path). Nabila is far away, connected through the sky mailbox (`relay`).

```js
  pings: { [SELF]: 0, 'e5f6a7b8': 4, 'c9d0e1f2': 6, '0a1b2c3d': 85 },
};
```
How many thousandths of a second each friend takes to answer. Nabila is slower (85) because she's far away.

### The memory and the "tell everyone" machine

```js
// State is never mutated (always rebuilt with spread/filter), and contextBridge
// copies whatever it hands to the page, so no cloning is needed here.
```
A sticky note explaining why we don't make extra copies. We never scribble on a form; we always make a fresh one. And the safe door already hands the page its own copy.

```js
let state = EMPTY_STATE;
```
The toy remote's **memory** 🧠: "right now, what situation are we in?" It starts as "not in a room".

```js
const stateListeners = [];
const noticeListeners = [];
```
Two empty **lists of people waiting to be told things**:
- `stateListeners` = "tell me whenever anything changes"
- `noticeListeners` = "tell me about popups, like 'the host left'"

```js
function setState(next) {
  state = next;
  stateListeners.forEach((cb) => cb(state));
}
```
A recipe called **"change the situation and tell everyone"**:
1. Replace the memory with the new situation.
2. Go through everyone on the "tell me" list (`forEach` = "for each one") and tell them the new situation. `cb` is short for *callback*, "the person to call back".

```js
// Real calls will go over IPC and be async, so the stub is async too.
const later = (fn) => new Promise((resolve) => setTimeout(() => resolve(fn()), 200));
```
A recipe called **"do it in a moment"** ⏳. It waits 200 thousandths of a second (0.2 seconds), then does the job and hands back the answer. Why? The *real* buttons will need a little time to talk to other laptops. If the toy answered instantly, UI 1 might build screens that break when real buttons take a moment.
- `Promise` = "I promise to give you an answer soon"
- `setTimeout(..., 200)` = "wait 200 thousandths of a second, then…"
- `resolve(fn())` = "do the job, then keep the promise with its answer"

### The buttons on the remote

```js
contextBridge.exposeInMainWorld('odyssync', {
```
"Through the safe door 🚪, give the page a remote control called **`odyssync`**." Every button inside the `{ }` below goes on that remote. The page can press them as `window.odyssync.createRoom(...)` and so on.

```js
  createRoom: (displayName) => later(() => {
    console.log('[stub] createRoom', displayName);
    setState({ ...FAKE_ROOM, isHost: true });
    return { roomNumber: state.roomNumber, pin: state.pin, localIps: state.localIps };
  }),
```
🔘 **Create room button.** Give it your name, and after 0.2 s it:
1. writes a note in the developer log (`console.log`) saying "someone pressed Create room", for debugging
2. switches to situation 2 (in a room), with **me as the owner** (`isHost: true`), and tells everyone
3. hands back the room number, PIN and Wi-Fi address, so the screen can show them

```js
  // PIN "0000" pretends to be wrong, room "000000" pretends not to exist.
  joinRoom: ({ roomNumber, pin, displayName, directIp }) => later(() => {
    console.log('[stub] joinRoom', { roomNumber, pin, displayName, directIp });
```
🔘 **Join room button.** Give it a room number, PIN, your name, and (optionally) the host's direct Wi-Fi address. It writes a log note first.

```js
    if (pin === '0000') return { ok: false, reason: 'bad_pin' };
```
"**If** the PIN is 0000, say *no, wrong PIN*." (`===` means "is exactly equal to".) This is a pretend error so UI 1 can build the "wrong PIN" message.

```js
    if (roomNumber === '000000') return { ok: false, reason: 'no_room' };
```
"If the room number is 000000, say *no, that room doesn't exist*." Another pretend error.

```js
    setState({ ...FAKE_ROOM, isHost: false });
    return { ok: true };
  }),
```
Otherwise: switch to situation 2, as a **guest** (`isHost: false`), tell everyone, and answer "ok, you're in!".

```js
  leaveRoom: () => later(() => {
    console.log('[stub] leaveRoom');
    setState(EMPTY_STATE);
  }),
```
🔘 **Leave room button.** Go back to situation 1 (no room) and tell everyone.

```js
  setLayout: (screens) => later(() => {
    console.log('[stub] setLayout', screens);
    setState({ ...state, screens }); // the stub does not recompute neighbours
  }),
```
🔘 **Move the screens button** (for the host arranging seats on the canvas). It keeps everything the same (`...state`) except the seats, which become the new ones. The toy doesn't work out new neighbours; the real one will.

```js
  setMode: (mode) => later(() => {
    console.log('[stub] setMode', mode);
    setState({ ...state, modes: { ...state.modes, [SELF]: mode } });
  }),
```
🔘 **Change my mode button.** Keep everything the same, keep everyone else's mode the same, and change **my** mode to the new one.

```js
  kick: (deviceId) => later(() => {
    console.log('[stub] kick', deviceId);
    setState({
      ...state,
      members: state.members.filter((m) => m.deviceId !== deviceId),
      screens: state.screens.filter((s) => s.deviceId !== deviceId),
    });
  }),
```
🔘 **Kick someone out button** (host only). `filter` means "keep only the ones that pass a test". The test is "is your name tag **not** (`!==`) the one being kicked?". So everyone stays except the kicked friend, from both the people list and the seats list.

```js
  sendDirect: (deviceId) => later(() => {
    console.log('[stub] sendDirect', deviceId);
  }),
```
🔘 **Send my tab straight to this friend button.** The toy only writes a log note.

```js
  onState: (cb) => {
    stateListeners.push(cb);
    cb(state); // give the current state right away
  },
```
🔔 **"Tell me when anything changes."** The screen gives its phone number (`cb`):
1. `push` = add it to the "tell me" list
2. tell it the current situation **straight away**, so the screen can draw itself immediately

```js
  onNotice: (cb) => {
    noticeListeners.push(cb);
  },
```
🔔 **"Tell me about popups."** It adds the screen to the popup list. The toy never sends popups on its own…

```js
  // Stub only, for UI 1 to test notices from DevTools. Not part of the contract.
  _stubNotice: (kind, text) => noticeListeners.forEach((cb) => cb({ kind, text })),
```
…so this **secret test button** lets UI 1 make a fake popup (like "the host left") while testing. It isn't in the team agreement, and it disappears when the real version arrives. The `_` at the start of its name is a hint that it's "not a real button".

```js
});
```
End of the remote control. It's now in the page's hands.

---

# File 4: `app/main/preload-overlay.js`, the glass window's remote 🪟

**Its job:** gives the glass window's page (UI 2's animations) a small remote with 4 buttons. Unlike file 3, this one is **already the real version**. The glass doesn't need fake data; it only reacts to messages like "a window is sliding in!", which the brain will send.

```js
// window.odyssync for the overlay (contract.md, "Renderer API" > Overlay).
// The overlay only reacts to events sent from main, so this is already the real
// version: main (later room.js, for now tools/replay.js) sends 'overlay:event'.
```
Sticky notes: "This is the real thing. The messages will come from `room.js` later, and from a pretend movie player (`tools/replay.js`, file 5) for now."

```js
const { contextBridge, ipcRenderer } = require('electron');
```
Borrow two tools:
- `contextBridge` = the safe door 🚪 to the page (same as file 3)
- `ipcRenderer` = a **walkie-talkie** 📻 between the page and the hidden brain. "IPC" means "messages between parts of the app".

```js
contextBridge.exposeInMainWorld('odyssync', {
```
"Through the safe door, give the glass page a remote called `odyssync`."

```js
  // cb(event): PREVIEW, DRAG_MOVE, CANCEL, COMMIT, PLACED, BOUNCE, REJECTED,
  // FAILED, VOICE. Every event has role, this screen's edge, and DIPs.
  onEvent: (cb) => ipcRenderer.on('overlay:event', (_e, event) => cb(event)),
```
🔔 **"Tell me what's happening."** The page gives its phone number (`cb`). Whenever the walkie-talkie hears a message on the channel named `'overlay:event'`, it passes the message (`event`) to the page. (`_e` is extra delivery info we don't need; the `_` means "ignore this".)

The sticky note lists the kinds of messages:

| Message | Means |
|---|---|
| `PREVIEW` | "Here's a photo of the window that's coming" |
| `DRAG_MOVE` | "It moved, here's where it is now" |
| `CANCEL` | "They pulled it back, slide the photo away" |
| `COMMIT` | "They let go! Spring it fully onto the screen" |
| `PLACED` | "The real window opened, fade the photo out" |
| `BOUNCE` | "Bounce it back (Focus mode)" |
| `REJECTED` / `FAILED` | "It was refused / something went wrong" |
| `VOICE` | "The voice assistant is listening / thinking / speaking" |

Every message also says your **role** (are you the sender or the receiver?), which **edge** of *your* screen it's on, and sizes in DIPs.

```js
  // true = the overlay catches clicks (Approval card); false = click-through.
  setInteractive: (on) => ipcRenderer.send('overlay:setInteractive', on),
```
🔘 **"Stop being a ghost for a moment" button.** Normally your clicks pass through the glass 👻. But in Approval mode, an **Accept / Reject** card appears, and you need to click it. This button says over the walkie-talkie: "catch clicks now" (`true`) or "back to ghost mode" (`false`).

```js
  // Approval card answer.
  answer: (transferId, accepted) => ipcRenderer.send('overlay:answer', transferId, accepted),
```
🔘 **"They answered the Approval card" button.** It sends which transfer it was (`transferId`, the delivery's tracking number) and whether they said yes (`accepted`).

```js
  // Where the ghost card ended, so the real window opens on the same spot.
  ghostSettled: (transferId, rect) => ipcRenderer.send('overlay:ghostSettled', transferId, rect),
```
🔘 **"The photo stopped here" button.** When the sliding photo comes to rest, the page reports **exactly where** (`rect` = a rectangle: position, width, height). That way the real window can open on the very same spot, so it looks like one smooth motion.

```js
});
```
End of the remote.

### ⚠️ One thing to know about file 4
The last three buttons **talk into the walkie-talkie, but nobody is listening on the other end yet.** That's on purpose, and harmless: unheard messages are simply dropped, with no errors.
- `answer` and `ghostSettled` will be heard by `room.js` (file 11), where the handoff rules live.
- `setInteractive` will be heard by `index.js` (about 3 new lines) when UI 2 builds the Approval card.

---

## The whole picture so far 🧩

```
         YOU START THE APP
                │
                ▼
   index.js (the "turn on" button)
       │                     │
       ▼                     ▼
 Control Center         Glass overlay
 window 🖥️               window 🪟
       │                     │
 preload-control.js     preload-overlay.js
 (toy remote, fake       (real remote, waits for
  room & friends)         "window sliding in!" messages)
       │                     │
       ▼                     ▼
 UI 1's screens          UI 2's animations
 (control/index.html)    (overlay/index.html)
```

---

# File 5: `tools/replay.js` + `tools/fake-drag.json`, the movie player 🎬

**Its job:** UI 2 has to build the sliding-window animations *now*, but the part that sends real "a window is coming!" messages between laptops isn't built yet. So we wrote a **script of a pretend drag** (`fake-drag.json`) and a **movie player** (`replay.js`) that reads the script aloud to the glass window, over and over.

Two new words:

| Word | What it means |
|---|---|
| **JSON** | A plain text file that holds forms `{ }` and lists `[ ]`, with no recipes in it. It's just data, like a filled-in sheet. |
| **Timer** | An alarm clock ⏰. "In 300 thousandths of a second, do this." |

## 5a: `tools/fake-drag.json`, the script

The whole file is **one list** `[ ... ]` of 28 lines. Every line looks like this:

```json
{ "at": 100, "event": { ... } }
```
- `at` = **when** to say this line, in thousandths of a second after the movie starts (100 = 0.1 s)
- `event` = **the message** to give the glass window

Every message has the same four fields first:

| Field | Value | Means |
|---|---|---|
| `type` | `"PREVIEW"`, `"DRAG_MOVE"`, `"COMMIT"` or `"PLACED"` | What kind of message this is |
| `role` | `"receiver"` | "You are the laptop **receiving** the window" |
| `edge` | `"LEFT"` | "It's coming in from **your left** edge" |
| `transferId` | `"3f1c2a9e-…"` | The delivery's tracking number. It's the same on all 28 lines, because it's one delivery. |

The 28 lines are four kinds of message, in this order:

**Line 1 (at 0): `PREVIEW`**, "here's the photo of the window that's coming"
```json
"imageUrl": "data:image/svg+xml;utf8,<svg ...>...</svg>"
```
`imageUrl` = the photo. Normally a photo is a separate file. Here the picture is **written as text inside the line** (that's what `data:` means): a drawing recipe saying "white rectangle 800 × 600, grey bar on top, three coloured dots, and the words *Odyssync - fake browser window*". It looks like a toy browser window, and we don't need an image file.

**Lines 2–26 (at 100, 140, 180 … 1060): `DRAG_MOVE`, 25 times**, "it moved, here's where it is now"
```json
"protrusionPx": 4, "centerRatio": 0.47, "width": 800, "height": 600, "mode": "collaborative"
```
- `protrusionPx` = **how far the window pokes into your screen**, in DIPs. Across the 25 lines it grows 4 → 7 → 16 → … → 600. It starts slowly, speeds up, and slows down at the end, the way a real hand moves.
- `centerRatio` = **how far down the edge** the window's middle is: 0 = very top, 1 = very bottom, 0.47 = just above the middle. It wobbles a little (0.445 to 0.495), because a hand never drags perfectly straight.
- `width`, `height` = the window's size (800 × 600).
- `mode` = your mode. `collaborative` means you accept windows straight away.

One line arrives every 40 thousandths of a second, so 25 lines make about one second of movement.

**Line 27 (at 1100): `COMMIT`**, "they let go! It's yours now"
```json
"kind": "tab", "title": "Hackathon schedule - Google Docs",
"url": "https://docs.google.com/document/d/1hackathon-schedule/edit",
"filename": null, "size": null, "fromName": "Rafi", "mode": "collaborative", "direct": false
```
- `kind` = what's being sent: a browser `tab` (not a file)
- `title`, `url` = the pretend tab's name and web address
- `filename`, `size` = empty (`null`), because those are only for files
- `fromName` = who sent it: Rafi
- `mode` = your mode again
- `direct` = `false` means "it was dragged here". `true` would mean "sent by voice, with no drag".

**Line 28 (at 1700): `PLACED`**, "the real window has opened, fade the photo out"
It has only the four common fields. It comes 0.6 s after the let-go, like a real browser taking a moment to open.

## 5b: `tools/replay.js`, the player

```js
// Replay tool: starts the normal app, then plays a hand-written fake drag
// (a JSON file) into the overlay window on a loop, so the overlay can be built
// before the real networking exists.
// Run: cd app && npx electron ../tools/replay.js ../tools/fake-drag.json
```
Sticky notes: what this is, and the exact words to type to run it.

```js
const fs = require('fs');
```
Borrow the **"files" toolbox** 📂 (`fs` = file system). It can open and read files on the computer.

```js
const path = require('path');
```
Borrow the "addresses" toolbox 🗺️ again (same as in file 2).

```js
const { app } = require('electron');
```
Borrow `app` (the whole app) from Electron, so we can ask "are you awake yet?".

```js
const { getOverlayWindow } = require('../app/main/index.js'); // starts both windows
```
Borrow **our own file 2**. Two things happen:
1. Borrowing it *runs* it, so the normal app starts and builds both windows.
2. We take its signpost `getOverlayWindow`, the "where's the glass window?" recipe from the bottom of file 2.

```js
// The JSON file from the command line, or fake-drag.json next to this file.
const file = path.resolve(process.argv[2] || path.join(__dirname, 'fake-drag.json'));
```
Work out **which script to play**:
- `process.argv[2]` = the file name you typed after the command when starting it
- `||` = "or, if that's empty…"
- `path.join(__dirname, 'fake-drag.json')` = "…use `fake-drag.json` in this same folder"
- `path.resolve(...)` = turn it into a full address, starting from the top of the computer

```js
const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
```
Open the script and read it:
- `fs.readFileSync(file, 'utf8')` = read the whole file as text
- `JSON.parse(...)` = turn that text into a real list the code can use
- The 28 lines are now in a box called `entries`

```js
let timers = [];
```
An empty list for the **alarm clocks** ⏰ we're about to set, so we can cancel them later.

```js
// Play every event at its time, then wait 2 seconds and play again.
function play(win) {
```
Start of a recipe called "play the movie once". `win` = the glass window to play it on.

```js
  timers.forEach(clearTimeout); // forget any pass that was still running
```
"Cancel every alarm clock from the last showing." Without this, restarting in the middle would leave two movies playing on top of each other.

```js
  console.log(`[replay] playing ${entries.length} events from ${file}`);
```
Write one note in the developer log: "playing 28 events from this file". `${...}` drops a value into the sentence.

```js
  timers = entries.map((entry) => setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send('overlay:event', entry.event);
  }, entry.at));
```
The heart of the player. For **each line of the script** (`map` = "do this for each one, and keep what you get back"):
- `setTimeout(..., entry.at)` = set an alarm clock for that line's time
- when it rings: `if (!win.isDestroyed())` = "if the glass window still exists" (`!` means "not")
- `win.webContents.send('overlay:event', entry.event)` = say the message into the walkie-talkie 📻 on the `'overlay:event'` channel. That's the channel file 4's `onEvent` listens on, so the page receives it.
- All 28 alarm clocks go into the `timers` box.

```js
  const end = entries[entries.length - 1].at + 2000;
```
Work out when to start again: the **last** line's time (`entries.length - 1` = the last one) plus 2000 thousandths of a second. That's 1700 + 2000 = 3.7 seconds.

```js
  timers.push(setTimeout(() => { if (!win.isDestroyed()) play(win); }, end));
```
Set one more alarm clock for that moment: "if the glass window still exists, **play the movie again**". The recipe calls itself, so the movie loops forever. `push` adds this alarm to the list too.

```js
}
```
End of the recipe.

```js
app.whenReady().then(() => {
  const win = getOverlayWindow();
```
"When the app has woken up, find the glass window." File 2 has already built it by now, because file 2 got in line first.

```js
  // Start each time the overlay page loads, so a reload restarts the movie.
  win.webContents.on('did-finish-load', () => play(win));
```
"Every time the glass window's **page finishes loading**, start the movie." This matters for two reasons:
1. A message sent before the page has loaded is lost, like talking to someone who hasn't picked up the phone yet.
2. If UI 2 reloads the page, the movie starts again from the beginning.

```js
  if (!win.webContents.isLoading()) play(win); // it may have loaded already
});
```
A safety check: "if the page has **already** finished loading, start right now", so we never wait forever for a moment that has passed.

### How UI 2 uses it
```
cd app
npx electron ../tools/replay.js ../tools/fake-drag.json
```
The app opens as normal, and every 3.7 seconds the glass window is told: photo → 25 moves → let go → placed.

---

# File 6: `app/main/sidecar-bridge.js`, the listening post 📞

> ⚠️ **Replaced in file 10.** This first version only listened and wrote things down. The file now does much more; see the File 10 section. The ideas here (server, port, `127.0.0.1`, parcels) still apply.

**Its job:** Tech 1 is writing a **Python helper** (the "sidecar"), a second small program that watches your mouse and windows on Windows. The helper needs to tell our app things like "a window is being dragged!". This file is the **phone on our side**: it waits for the helper to call, and for now it only **writes down everything it hears**. Answering back, and switching the helper on, come later (file 10).

Three new words:

| Word | What it means |
|---|---|
| **Server** | The side that **waits to be called**. The caller is the "client". Here our app is the server, and the Python helper is the caller. |
| **Port** | A numbered door on a computer. Each program that waits for calls picks a door number. Ours is **8089**. Only one program can use a door at a time. |
| **`127.0.0.1`** | The address that always means "**this same computer**". A call to it never leaves your laptop, so nobody outside can reach this door. |

```js
// Sidecar bridge, first version: a listening post on ws://127.0.0.1:8089.
// The Python sidecar connects here and we only log what it sends.
// The later version will also start the sidecar, restart it if it dies,
// send commands back to it and pass its messages on to the rest of the app.
```
Sticky notes: "This is the first version. It only listens and writes down. The later version does more."

```js
const { WebSocketServer } = require('ws');
```
Borrow the **phone-exchange maker** from the `ws` toolbox (the library downloaded in file 1). A *WebSocket* is a phone line that stays open, so both sides can talk at any moment.

```js
function start() {
```
Start of a recipe called "open the listening post". Nothing happens until someone uses this recipe.

```js
  const server = new WebSocketServer({ host: '127.0.0.1', port: 8089 });
```
"Make a phone exchange on **this computer only** (`127.0.0.1`), at **door 8089**." From this moment it waits for calls.

### If the door is already taken

```js
  // A failed listen (most often: another copy of the app holds the port) lands here.
  server.on('error', (err) => {
```
"If something goes wrong with the exchange, do this." `err` = a note describing what went wrong.

```js
    if (err.code === 'EADDRINUSE') {
      console.log('[sidecar] port 8089 is busy, bridge not started (is another copy of Odyssync running?)');
```
`EADDRINUSE` is the computer's code for "**that door is already in use**". This happens when two copies of the app are open, for example the normal app plus the movie player from file 5. We write one clear note in the developer log and **carry on**. The app does not crash.

```js
    } else {
      console.log('[sidecar] bridge error: ' + err.message);
    }
  });
```
"For any other problem, write down what it was." (`+` glues two pieces of text together.)

### When the helper calls

```js
  server.on('connection', (socket) => {
```
"When someone **calls** (connects), do this." `socket` = that one open phone line.

```js
    console.log('[sidecar] connected');
```
Write down: "the helper has connected".

```js
    socket.on('close', () => console.log('[sidecar] disconnected'));
```
"When this line **hangs up**, write down: disconnected."

```js
    socket.on('error', (err) => console.log('[sidecar] socket error: ' + err.message));
```
"If this line has a problem, write it down." Without this, a problem on the line would crash the whole app.

```js
    socket.on('message', (data, isBinary) => {
```
"Whenever a **message** arrives on this line, do this."
- `data` = the message itself
- `isBinary` = `true` if it's raw data (like a picture), `false` if it's plain text

### A text message

```js
      if (!isBinary) {
```
"If it is **not** raw data", so it's plain text. (`!` means "not".)

```js
        // Text message: log it on one line, even if it is not valid JSON.
        const text = data.toString();
```
Turn the message into readable text and put it in a box called `text`.

```js
        try { console.log('[sidecar] ' + JSON.stringify(JSON.parse(text))); }
```
`try` = "**try** this, and if it fails don't crash".
- `JSON.parse(text)` = read the text as JSON (a filled-in form)
- `JSON.stringify(...)` = write that form back as one tidy line
- then write it in the log, like `[sidecar] {"type":"SIDECAR_READY",...}`

```js
        catch { console.log('[sidecar] (not JSON) ' + text.replace(/\s+/g, ' ')); }
```
`catch` = "if the try failed, do this instead". The text wasn't a proper form, so write it down anyway with the label `(not JSON)`. The `replace(/\s+/g, ' ')` part squeezes line breaks and long gaps into single spaces, so it stays on one line.

```js
        return;
      }
```
"Done with this message, stop here."

### A picture message

```js
      // Binary message: [uint32 LE header length][JSON header][payload bytes].
```
A sticky note describing how raw messages are packed, as agreed in `contract.md`. Think of a **parcel** 📦 in three parts:
1. a **number** (4 bytes long) saying how long the label is
2. the **label** (JSON): what's inside, such as "a window picture, 320 × 200"
3. the **contents**: the picture itself

(A *byte* is the smallest piece of computer data. A small photo is tens of thousands of bytes.)

```js
      try {
        const headerLength = data.readUInt32LE(0);
```
"Try this." Read the **number** at the very start (position 0): how long is the label?

```js
        if (4 + headerLength > data.length) throw new Error('header longer than frame');
```
A sanity check: "if the label claims to be **longer than the whole parcel**, that's nonsense". `throw` = "stop and raise an alarm", which jumps to the `catch` below.

```js
        const header = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
```
Cut out the **label** (`subarray` = "the piece from here to there", starting just after the 4-byte number), turn it into text, and read it as a form.

```js
        const payloadSize = data.length - 4 - headerLength;
```
Work out the size of the **contents**: the whole parcel, minus the number, minus the label.

```js
        console.log('[sidecar] binary ' + JSON.stringify(header) + ' + ' + payloadSize + ' bytes');
```
Write down the label and the size, like `[sidecar] binary {"type":"LOCAL_WINDOW_PREVIEW",...} + 48211 bytes`. We don't write down the picture itself, because it would flood the log with garbage.

```js
      } catch (err) {
        console.log('[sidecar] bad binary frame (' + data.length + ' bytes): ' + err.message);
      }
```
"If anything in that try failed (a broken parcel), write down that it was bad, how big it was, and why." The app carries on.

```js
    });
  });
}
```
End of "when a message arrives", end of "when someone calls", end of the recipe.

```js
module.exports = { start };
```
"Other files may use my `start` recipe." It's the only thing this file shares.

## The two new lines in `index.js` (file 2)

```js
const sidecarBridge = require('./sidecar-bridge');
```
Line 4: borrow the new file (`./` = "in this same folder") and call it `sidecarBridge`.

```js
  sidecarBridge.start();
```
Line 44, inside "when the app has woken up": after making the two windows, **open the listening post**.

### What Tech 1 can do with it today
Start the app with `cd app && npm start`, then run their Python helper and connect it to `ws://127.0.0.1:8089`. Every message it sends shows up in the terminal that started the app, with `[sidecar]` in front.

---

# File 7: `app/server/server.js`, the front desk 🛎️

**Its job:** laptops can't talk to each other until they've found each other. This file is the **front desk** of a room:
- it checks the **PIN** at the door
- it keeps the **guest list**
- it **passes notes** between laptops
- it announces who **arrived** and who **left**

It knows nothing about windows, screens or dragging. It only passes notes.

**The same file runs in two places:**
- ☁️ on **Railway**, a computer on the internet (the "sky desk"), so far-away laptops can join
- 💻 **inside the host's laptop** (the "room desk"), so laptops on the same Wi-Fi can talk without internet

New words:

| Word | What it means |
|---|---|
| **Room** | One group of laptops working together. Each room has a 6-digit number and a 4-digit PIN. |
| **Host** | The laptop that created the room. When it leaves, the room ends. |
| **Member** | Any laptop in the room, the host included. |
| **Socket** | One open phone line between the desk and one laptop (same as in file 6). |
| **`return`** | "Stop this recipe here" (and sometimes "hand back this answer"). |
| **`if (...)`** | "Only do the next thing if this is true." |
| **`for (...)`** | "Do the next thing once for each item." |
| **`delete`** | Remove a field from a form. |

Every note between laptops has the same four fields first (the "envelope" from `contract.md`): `type` (what kind of note), `fromId` (who sent it), `toId` (who it's for, or `"*"` for everyone) and `mid` (a counter).

```js
// Room server: a simple router between laptops. It checks the PIN, keeps the
// member list, passes messages on by toId and announces joins and leaves.
// The same file runs in the cloud (`node app/server/server.js`) and inside
// the host laptop (`start({ port, local: true })` from the app).
```
Sticky notes saying what this file is and the two ways it's started.

```js
const { WebSocketServer } = require('ws');
```
Borrow the phone-exchange maker (same as file 6).

```js
const MAX_MEMBERS = 8;
```
A box holding the rule "at most 8 laptops in a room".

```js
const HEARTBEAT_MS = 800; // worst case to spot a dead laptop is 3 beats, so 800 ms keeps it under 3 s
```
A box holding "tap every laptop on the shoulder every 800 thousandths of a second". Why 800 and not 1000? A dead laptop is noticed after at most 3 taps. 3 × 800 = 2.4 seconds, safely under the 3-second rule. With 1000 it was sometimes just over 3 seconds in testing.

## Opening the desk

```js
function start({ port, local }) {
```
Start of the big recipe "open a front desk". It takes two settings:
- `port` = which numbered door to wait at
- `local` = `true` for the room desk inside the host's laptop, empty for the sky desk

Everything below, down to the last `}`, is inside this recipe.

```js
  const rooms = {}; // roomNumber -> { pin, hostId, hostLocalIps, localPort, members }
```
The desk's **big book of rooms** 📒, empty at first. Each page is one room: its PIN, who the host is, the host's Wi-Fi addresses and door number, and the guest list (`members`).

```js
  const server = new WebSocketServer({ port });
```
Make the phone exchange at that door. Unlike file 6, there is no `127.0.0.1`, so **other computers can call in**.

```js
  console.log('[server] listening on port ' + port + (local ? ' (local)' : ' (cloud)'));
```
Write a note in the log: "listening on port 8080 (cloud)". The `local ? 'A' : 'B'` part means "if local is true use A, otherwise B".

```js
  server.on('error', (err) => console.log('[server] error: ' + err.message));
```
"If the exchange has a problem (for example the door is taken), write it down. Don't crash."

## Five small helper recipes

```js
  // Send one JSON message that the server itself writes.
  function send(socket, toId, type, fields) {
    socket.send(JSON.stringify({ type, fromId: 'server', toId, ...fields }));
  }
```
**"Send a note from the desk itself."** It builds a form with the note's kind, `fromId: 'server'` (signed "the desk"), who it's for, and any extra fields (`...fields` = "copy them all in"). `JSON.stringify` turns the form into text, and `socket.send` says it down that laptop's phone line.

```js
  // Send a server message to every member of a room, except `skipId` if given.
  function tellRoom(room, type, fields, skipId) {
    for (const id in room.members) {
      if (id !== skipId) send(room.members[id].socket, id, type, fields);
    }
  }
```
**"Announce to the whole room."** Go through the guest list. For each guest, unless they're the one to skip, send them the note using the recipe above.

```js
  // Embedded server only: tell everyone who is on this server right now.
  function sendLocalPeers(room) {
    if (local) tellRoom(room, 'LOCAL_PEERS', { deviceIds: Object.keys(room.members) });
  }
```
**"Tell everyone who's on the local Wi-Fi."** Only the room desk does this (`if (local)`). It announces a `LOCAL_PEERS` note with the list of name tags (`Object.keys(...)` = "just the labels of the form"). Later, a laptop uses this list to decide: "is my friend reachable on the fast local path?"

```js
  // The room this socket belongs to, or null if it is not (or no longer) a member.
  function roomOf(socket) {
    const room = socket.room;
    if (!room || !room.members[socket.deviceId] || room.members[socket.deviceId].socket !== socket) return null;
    return room;
  }
```
**"Which room is this phone line in?"** It answers "none" (`null`) in three cases (`||` = "or"):
- the line never joined a room
- its laptop is no longer on the guest list (it was kicked)
- the guest list has a **different, newer line** for that laptop (it reconnected)

Otherwise it hands back the room. This one check is what stops a laptop from being announced as "left" twice.

```js
  // Pass a message on by toId: "*" means everyone else in the room.
  function forward(room, fromSocket, toId, data, isBinary) {
    for (const id in room.members) {
      if (id === fromSocket.deviceId) continue;
      if (toId === '*' || toId === id) room.members[id].socket.send(data, { binary: isBinary });
    }
  }
```
**"Pass a note on."** Go through the guest list:
- skip the sender (`continue` = "skip to the next one")
- if the note is for everyone (`'*'`) or for this guest, send it down their line **exactly as it arrived**, text or picture

The desk never opens or changes the note.

## Creating a room

```js
  function createRoom(socket, msg) {
```
Recipe for "a host asks to create a room". `msg` = the request form.

```js
    if (rooms[msg.roomNumber] || (local && Object.keys(rooms).length > 0)) {
      return send(socket, msg.fromId, 'ROOM_ERROR', { reason: 'taken' });
    }
```
"If that room number is **already in the book**, or this is the room desk and it already has its one room, answer `ROOM_ERROR: taken` and stop." The host's app will then pick another number.

```js
    const room = { pin: msg.pin, hostId: msg.fromId, hostLocalIps: msg.hostLocalIps, localPort: msg.localPort, members: {}, number: msg.roomNumber };
```
Write a new page: the PIN, the host's name tag, the host's Wi-Fi addresses and door, an empty guest list, and the room's own number.

```js
    room.members[msg.fromId] = { socket, profile: msg.profile };
```
Put the host on the guest list as the first guest: their phone line and their profile (name, screen size, zoom).

```js
    rooms[msg.roomNumber] = room;
```
Put the page in the big book under its room number.

```js
    socket.deviceId = msg.fromId;
    socket.room = room;
```
Stick two labels on this phone line: whose laptop it is, and which room it's in.

```js
    console.log('[server] room ' + msg.roomNumber + ' created by ' + msg.fromId);
    send(socket, msg.fromId, 'ROOM_CREATED', {});
    sendLocalPeers(room);
  }
```
Write it in the log, answer the host "`ROOM_CREATED`", and (room desk only) send the local list.

## Joining a room

```js
  function joinRoom(socket, msg) {
    const room = local ? Object.values(rooms)[0] : rooms[msg.roomNumber];
```
Recipe for "a laptop asks to join". Find the room: the room desk uses its **only** room (`Object.values(rooms)[0]` = "the first page in the book") and ignores the number. The sky desk looks the number up.

```js
    const reject = (reason) => send(socket, msg.fromId, 'JOIN_REJECTED', { reason });
```
A tiny recipe for saying "no", with a reason.

```js
    if (!room) return reject('no_room');
    if (msg.pin !== room.pin) return reject('bad_pin');
```
- no such room → "no, `no_room`"
- wrong PIN → "no, `bad_pin`"

```js
    const old = room.members[msg.fromId];
    if (!old && Object.keys(room.members).length >= MAX_MEMBERS) return reject('full');
```
`old` = is this laptop **already** on the guest list? If it's new and the room already has 8, say "no, `full`". A laptop that's coming back doesn't count as a 9th.

```js
    room.members[msg.fromId] = { socket, profile: msg.profile };
    socket.deviceId = msg.fromId;
    socket.room = room;
```
Put the laptop on the guest list with this phone line, and label the line.

```js
    const members = Object.keys(room.members).map((id) => ({ deviceId: id, profile: room.members[id].profile }));
```
Make a clean copy of the guest list to hand out: for each guest, just their name tag and profile (not their phone line).

```js
    send(socket, msg.fromId, 'JOIN_ACCEPTED', { hostId: room.hostId, members, hostLocalIps: room.hostLocalIps, localPort: room.localPort });
```
Answer "**you're in**": who the host is, the guest list, and the host's Wi-Fi addresses and door (so the laptop can try the fast local path later).

```js
    sendLocalPeers(room); // before MEMBER_JOINED, so the others already know the newcomer is on this server
```
Room desk only: send everyone the updated "who's on the local Wi-Fi" list. The order matters: the list goes out **before** the "someone joined" announcement below. That way, when the host hears about the newcomer and replies to them, the host's mail carrier already knows to use the local line. (Found while testing file 9: with the old order, the host's first reply to a laptop that joined by IP got lost.)

```js
    if (old) {
      // Same laptop came back on a new socket: swap quietly, nobody else is told.
      old.socket.close();
      console.log('[server] ' + msg.fromId + ' rejoined room ' + room.number);
```
If the laptop was already there: hang up its **old** line quietly and log it. Nobody else is told, so there's no flicker on their screens.

```js
    } else {
      console.log('[server] ' + msg.fromId + ' joined room ' + room.number);
      tellRoom(room, 'MEMBER_JOINED', { member: { deviceId: msg.fromId, profile: msg.profile } }, msg.fromId);
    }
```
Otherwise it's a real newcomer: log it and announce `MEMBER_JOINED` to everyone **except** the newcomer.

```js
  }
```
End of the join recipe.

## Kicking someone out

```js
  function kickMember(socket, room, msg) {
    const target = room.members[msg.targetDeviceId];
```
Recipe for "remove this guest". `target` = the guest to remove.

```js
    if (socket.deviceId !== room.hostId || msg.targetDeviceId === room.hostId || !target) return;
```
Do **nothing** if the asker is not the host, or the host is trying to kick itself, or that guest isn't in the room.

```js
    tellRoom(room, 'MEMBER_LEFT', { deviceId: msg.targetDeviceId, reason: 'kicked' });
```
Announce to everyone, including the kicked laptop: "this one left, reason: kicked".

```js
    delete room.members[msg.targetDeviceId]; // removed first, so its close event does nothing
    target.socket.close();
```
Take them off the guest list, then hang up their line. The order matters: because they're already off the list, hanging up doesn't cause a second "left" announcement.

```js
    console.log('[server] ' + msg.targetDeviceId + ' left room ' + room.number + ' (kicked)');
    sendLocalPeers(room);
  }
```
Log it, and (room desk only) send the updated local list.

## When a laptop calls the desk

```js
  server.on('connection', (socket) => {
```
"Whenever a laptop **calls**, do all of this for its phone line."

```js
    socket.missedPings = 0;
    socket.on('pong', () => { socket.missedPings = 0; });
```
Start a counter on the line: "shoulder taps not answered: 0". Whenever the laptop answers a tap (a `pong`), reset it to 0.

```js
    socket.on('error', (err) => console.log('[server] socket error: ' + err.message));
```
A problem on this line gets written down, not crashed on.

### Reading a note

```js
    socket.on('message', (data, isBinary) => {
      let msg;
      try {
```
"When a note arrives on this line…" Make an empty box `msg` for the note's form, and **try** to read it:

```js
        if (isBinary) {
          // [uint32 LE header length][JSON header][payload]: we only need the header.
          const headerLength = data.readUInt32LE(0);
          if (4 + headerLength > data.length) throw new Error('header longer than frame');
          msg = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
```
If it's a **parcel** 📦 (picture or file): read the label, exactly as in file 6. The desk only needs the label to see who it's for.

```js
        } else {
          msg = JSON.parse(data.toString());
        }
```
If it's plain text: read it as a form.

```js
        if (!msg || typeof msg !== 'object') throw new Error('not an object');
```
"If what we read isn't a form at all, raise the alarm."

```js
      } catch (err) {
        return console.log('[server] ignored bad message: ' + err.message);
      }
```
If reading failed: write "ignored bad message" and stop. A broken note never crashes the desk.

### Deciding what to do with it

```js
      const room = roomOf(socket);
```
Which room is this line in (or none)?

```js
      if (!isBinary && !room && msg.type === 'CREATE_ROOM') return createRoom(socket, msg);
      if (!isBinary && !room && msg.type === 'JOIN_ROOM') return joinRoom(socket, msg);
```
(`&&` = "and".) A text note from a line that's **not in a room yet**: if it says `CREATE_ROOM`, follow the create recipe. If it says `JOIN_ROOM`, follow the join recipe.

```js
      if (!room) return; // not in a room yet: ignore everything else
```
Anything else from a stranger is **ignored**.

```js
      if (!isBinary && msg.type === 'PING') return send(socket, socket.deviceId, 'PONG', { t: msg.t });
```
A `PING` note gets a `PONG` straight back with the same number `t`. The laptop uses this to time how fast the desk answers (the "ping" shown on the roster).

```js
      if (!isBinary && msg.type === 'KICK_MEMBER') return kickMember(socket, room, msg);
```
A `KICK_MEMBER` note: follow the kick recipe.

```js
      if (msg.toId) forward(room, socket, msg.toId, data, isBinary);
    });
```
**Everything else** with a "to" address is simply passed on. This one line carries all the drag, picture and handoff notes of the whole app.

### When a line goes dead

```js
    socket.on('close', () => {
      const room = roomOf(socket);
      if (!room) return; // never joined, was kicked, or was replaced by a rejoin
```
"When this phone line closes…" If it wasn't in a room (or was kicked, or replaced by a newer line), there's nothing to do.

```js
      const id = socket.deviceId;
      delete room.members[id];
```
Take that laptop off the guest list.

```js
      if (id === room.hostId) {
        // Host gone: the room ends for everyone.
        tellRoom(room, 'ROOM_CLOSED', {});
        for (const otherId in room.members) room.members[otherId].socket.close();
        room.members = {};
        delete rooms[room.number];
        console.log('[server] room ' + room.number + ' closed (host ' + (socket.lost ? 'lost' : 'left') + ')');
        return;
      }
```
**If it was the host:** announce `ROOM_CLOSED` to everyone, hang up on everyone, empty the guest list, tear the page out of the big book, log it, and stop.

```js
      const reason = socket.lost ? 'lost' : 'left';
```
Otherwise work out why they're gone: `lost` if the desk gave up on them (no answer to the shoulder taps), `left` if they hung up normally.

```js
      console.log('[server] ' + id + ' left room ' + room.number + ' (' + reason + ')');
      tellRoom(room, 'MEMBER_LEFT', { deviceId: id, reason });
      sendLocalPeers(room);
    });
  });
```
Log it, announce `MEMBER_LEFT` with the reason to everyone still there, and (room desk only) send the updated local list. That ends "when a laptop calls".

## The shoulder taps (heartbeat) 💓

```js
  // Heartbeat: a ws-level ping every beat; two unanswered in a row means the laptop is gone.
  const timer = setInterval(() => {
```
`setInterval` = an alarm clock that rings **again and again**. Every 800 thousandths of a second, do this:

```js
    for (const socket of server.clients) {
```
For every phone line the desk has open:

```js
      if (socket.missedPings >= 2) {
        socket.lost = true;
        socket.terminate();
        continue;
      }
```
If this laptop has **not answered two taps in a row**: mark the line as `lost`, cut it at once (`terminate`), and move on to the next line. Cutting it sets off the "line goes dead" steps above.

```js
      socket.missedPings++;
      socket.ping();
    }
  }, HEARTBEAT_MS);
```
Otherwise add 1 to its "not answered" counter (`++` = "add one") and tap it on the shoulder (`ping`). A live laptop answers automatically, which resets the counter to 0. A closed lid or dead Wi-Fi can't answer, so the counter climbs.

## Closing the desk

```js
  // Closing the server also stops the heartbeat and drops anyone still connected.
  const closeServer = server.close.bind(server);
```
Keep the exchange's original "close" recipe in a box called `closeServer`.

```js
  server.close = (cb) => {
    clearInterval(timer);
    for (const socket of server.clients) socket.terminate();
    return closeServer(cb);
  };
```
Replace "close" with a more thorough one: **stop the repeating alarm clock**, cut every open line, then do the original close. Without this, a host who leaves a room would keep a hidden clock ticking forever.

```js
  return server;
}
```
Hand the finished desk back to whoever opened it (so they can close it later). End of the big recipe.

```js
module.exports = { start };
```
"Other files may use my `start` recipe." The host's app will use it in file 9.

```js
if (require.main === module) start({ port: process.env.PORT || 8080 });
```
"If this file was **started directly** (`node app/server/server.js`), and not borrowed by another file, open a desk right now." That's how Railway runs it. `process.env.PORT` = the door number Railway hands us, and `|| 8080` = "or 8080 if nobody gave one".

---

# File 8: `app/main/transport.js`, the mail carrier 📬

**Its job:** file 7 is the front desk. This file is the **mail carrier inside each laptop**. It:
- holds the laptop's **phone lines** to the front desks (up to two: `cloud` = the sky desk, `local` = the room desk on the Wi-Fi)
- **writes the envelope** on every note going out (from, to, counter)
- **picks the right line** for each friend
- **throws away repeats** of notes coming in, then hands the rest to the app

It knows nothing about rooms or windows. It only carries notes.

New words:

| Word | What it means |
|---|---|
| **Promise** | "I'll give you an answer soon." Used when something takes time, like dialling a phone. (You met it in file 3.) |
| **`true` / `false`** | Yes / no. |
| **Set** | A bag that remembers which things it has seen. You can ask it "have you seen this before?". |
| **`!`** and **`!!`** | `!` = "not". `!!` = "turn this into a plain yes or no". |

```js
// Transport: the message carrier of one laptop (TransportManager in the docs).
// It holds up to two sockets, "cloud" (the relay) and "local" (the host's
// embedded server), stamps the envelope on everything we send, picks the right
// socket for each target and hands incoming messages on after dropping repeats.
// Plain Node with `ws` only, so it can be tested without Electron.
```
Sticky notes describing the job above.

```js
const WebSocket = require('ws');
```
Borrow the phone-line toolbox. This time we're the **caller**, not the exchange.

```js
const MAX_SEEN = 5000; // per sender; past this we forget and start again (keeps memory small)
```
A box holding "remember at most 5000 note numbers per friend", so the memory never grows forever.

```js
function createTransport(deviceId) {
```
Start of the big recipe "make one mail carrier". `deviceId` = this laptop's name tag. Everything down to the matching `}` is inside it.

## The carrier's pockets

```js
  const sockets = {}; // "cloud" / "local" -> ws socket (also while it is still connecting)
```
A form with up to two phone lines, labelled `cloud` and `local`.

```js
  const seen = {}; // fromId -> Set of mids we already handed on
```
For each friend, a bag (Set) of note numbers already delivered.

```js
  let nextMid = 1;
```
The counter for our own outgoing notes. The first note is number 1.

```js
  let peers = []; // deviceIds from the last LOCAL_PEERS
```
The latest list of who is on the local Wi-Fi line (the room desk sends this, see file 7).

```js
  let messageCb = () => {};
  let closeCb = () => {};
```
Two "phone numbers to call back", empty for now: who to tell when a note arrives, and who to tell when a line drops.

```js
  const isOpen = (name) => !!sockets[name] && sockets[name].readyState === WebSocket.OPEN;
```
A tiny recipe: "**is this line open?**" Yes only if the line exists **and** its state is OPEN.

```js
  // Stop tracking this socket (only if it is still the one under that name).
  function forget(name, socket) {
    if (sockets[name] !== socket) return false;
    delete sockets[name];
    if (name === 'local') peers = [];
    return true;
  }
```
**"Take this line out of my pocket."**
- If the pocket now holds a different (newer) line, do nothing and answer `false`.
- Otherwise remove it. If it was the local line, also empty the "who's on the local Wi-Fi" list, since we can't reach them that way any more.
- Answer `true`.

## Dialling a front desk

```js
  // Open a socket; resolves true once open, false on error or timeout. Never rejects.
  function connect(name, url, timeoutMs = 5000) {
```
Recipe: "**dial a front desk**". `name` = which pocket (`cloud` or `local`), `url` = the desk's address, `timeoutMs` = how long to wait (5 seconds unless told otherwise).

```js
    close(name);
```
Hang up any old line in that pocket first.

```js
    return new Promise((resolve) => {
```
Hand back a promise: "I'll tell you `true` or `false` soon." `resolve` is how we keep the promise.

```js
      const socket = new WebSocket(url);
      sockets[name] = socket;
```
Start dialling, and put the line in the pocket straight away.

```js
      let opened = false;
      let settled = false;
```
Two notes to self: "has it connected?" and "have I already given my answer?".

```js
      const timer = setTimeout(() => fail('timed out'), timeoutMs);
```
Set an alarm clock: "if nothing has happened when this rings, give up".

```js
      function fail(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log('[transport] ' + name + ' connect to ' + url + ' failed: ' + reason);
        forget(name, socket); // forgotten first, so its close event does nothing
        socket.terminate();
        resolve(false);
      }
```
The "**it didn't work**" recipe:
- if I've already answered, do nothing
- mark as answered and cancel the alarm clock
- write the reason in the log
- take the line out of the pocket, then cut it
- keep the promise with **`false`**

```js
      socket.on('open', () => {
        if (settled) return;
        settled = opened = true;
        clearTimeout(timer);
        resolve(true);
      });
```
"When the desk **picks up**": mark as answered and connected, cancel the alarm clock, keep the promise with **`true`**.

```js
      socket.on('error', (err) => {
        if (!settled) return fail(err.message);
        if (opened) console.log('[transport] ' + name + ' socket error: ' + err.message);
      });
```
"If the line has a problem": if we were still dialling, that's a failure. If it was already connected, just write it down.

```js
      socket.on('close', () => {
        // Still tracked here means we did not ask for this close.
        if (forget(name, socket) && opened) closeCb(name);
      });
```
"When the line closes": if it was still in the pocket, **we didn't hang up ourselves**, so it dropped by surprise. Take it out and tell the app "this line dropped" (`closeCb`). If we hung up on purpose, it was already out of the pocket and nobody is told.

```js
      socket.on('message', (data, isBinary) => {
        if (sockets[name] === socket) receive(name, data, isBinary);
      });
    });
  }
```
"When a note arrives on this line", and the line is still the one in the pocket, follow the `receive` recipe below.

## Hanging up on purpose

```js
  // Close a socket we asked to close: onClose is not called for it.
  function close(name) {
    const socket = sockets[name];
    if (!socket) return;
    forget(name, socket);
    socket.close();
  }
```
Find the line in that pocket. If there is none, do nothing. Otherwise take it out of the pocket **first**, then hang up. Because of that order, nobody gets a "line dropped!" alarm.

## A note arrives

```js
  // One incoming message: parse it, drop repeats, then hand it on.
  function receive(name, data, isBinary) {
    let msg;
    let payload = null;
```
Two boxes: `msg` for the note's form, and `payload` for a parcel's contents (empty unless it's a parcel).

```js
    try {
      if (isBinary) {
        // [uint32 LE header length][JSON header][payload bytes]
        const headerLength = data.readUInt32LE(0);
        if (4 + headerLength > data.length) throw new Error('header longer than frame');
        msg = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
        payload = data.subarray(4 + headerLength);
```
If it's a **parcel** 📦: read the label exactly as in files 6 and 7. This time also keep the **contents** (everything after the label) in `payload`, because the app needs the picture.

```js
      } else {
        msg = JSON.parse(data.toString());
      }
      if (!msg || typeof msg !== 'object') throw new Error('not an object');
    } catch (err) {
      return console.log('[transport] ignored bad message on ' + name + ': ' + err.message);
    }
```
If it's text: read it as a form. If anything can't be read, write "ignored bad message" and stop. No crash.

```js
    // Server messages have no mid and are never dropped.
    if (msg.mid !== undefined) {
```
"If the note has a counter number" (notes from the front desk itself don't, so they skip this part):

```js
      const set = seen[msg.fromId] || (seen[msg.fromId] = new Set());
```
Get the bag for that sender, or make a new empty bag if this is their first note.

```js
      if (set.has(msg.mid)) return;
```
"**Seen this number from this friend before? Throw the note away.**" This is what stops a note sent on both lines from arriving twice.

```js
      if (set.size >= MAX_SEEN) set.clear();
      set.add(msg.mid);
    }
```
If the bag is full (5000), empty it. Then drop this number in the bag.

```js
    if (name === 'local' && msg.type === 'LOCAL_PEERS') peers = Array.isArray(msg.deviceIds) ? msg.deviceIds : [];
```
If the note is the room desk's "who's on the local Wi-Fi" list, keep the list (or an empty list if it's malformed).

```js
    messageCb(msg, payload, name);
  }
```
Hand the note to the app: the form, the parcel contents if any, and which line it came on.

## Choosing a line

```js
  // The socket for one laptop: local if it is on the local server with us, else cloud.
  function pick(id) {
    if (isOpen('local') && peers.includes(id)) return sockets.local;
    if (isOpen('cloud')) return sockets.cloud;
    return null;
  }
```
**"Which line reaches this friend?"**
1. If the local line is open **and** the friend is on the local list → the local line (fast).
2. Otherwise, if the sky line is open → the sky line.
3. Otherwise → none (`null`).

```js
  // "*" goes on every open socket (same mid, the receiver drops the repeat).
  function targets(id) {
    if (id === '*') return ['cloud', 'local'].filter(isOpen).map((name) => sockets[name]);
    const socket = pick(id);
    return socket ? [socket] : [];
  }
```
**"Which lines should this note go out on?"**
- For everyone (`'*'`): **every open line**. A friend on both lines gets it twice, and their carrier throws the repeat away.
- For one friend: the one line from `pick`, or an empty list if there is none.

```js
  // A copy of the caller's fields with our envelope on top.
  const stamp = (toId, fields) => ({ ...fields, fromId: deviceId, toId, mid: nextMid++ });
```
**"Write the envelope."** Make a copy of the note and add: from = my name tag, to = the receiver, number = the counter. `nextMid++` means "use the number, then add one for next time".

## Sending

```js
  function sendToServer(name, msg) {
    if (!isOpen(name)) return false;
    sockets[name].send(JSON.stringify(stamp('server', msg)));
    return true;
  }
```
**"Send a note to a front desk itself"** (create a room, join, kick, ping). If that line isn't open, answer `false`. Otherwise stamp it "to: server", send it, and answer `true`.

```js
  function sendToPeer(id, msg) {
    const list = targets(id);
    if (list.length === 0) return false;
    const text = JSON.stringify(stamp(id, msg));
    for (const socket of list) socket.send(text);
    return true;
  }
```
**"Send a note to a friend"** (or to everyone). Find the lines. If there are none, answer `false`, "not sent". Otherwise stamp the note once, send the same text on each line, and answer `true`.

```js
  function sendBinaryToPeer(id, header, buffer) {
    const list = targets(id);
    if (list.length === 0) return false;
```
**"Send a parcel to a friend"** (a picture or file). The start is the same: find the lines, or answer `false`.

```js
    const headerBytes = Buffer.from(JSON.stringify(stamp(id, header)), 'utf8');
```
Stamp the label and turn it into raw bytes.

```js
    const length = Buffer.alloc(4);
    length.writeUInt32LE(headerBytes.length, 0);
```
Make a 4-byte slot and write the label's length into it.

```js
    const frame = Buffer.concat([length, headerBytes, buffer]);
    for (const socket of list) socket.send(frame);
    return true;
  }
```
Glue the three parts together (length, label, contents) into one parcel, send it on each line, and answer `true`.

## The carrier's public buttons

```js
  return {
    connect,
    close,
    isOpen,
    sendToServer,
    sendToPeer,
    sendBinaryToPeer,
```
Hand back the carrier with its buttons. These six are the recipes above.

```js
    bufferedAmount: (id) => (pick(id) ? pick(id).bufferedAmount : 0),
```
"**How much is still waiting to go out** on this friend's line?" It's 0 if there's no line. File 11 uses this to skip old drag positions when a line is slow.

```js
    onMessage: (cb) => { messageCb = cb; },
    onClose: (cb) => { closeCb = cb; },
```
"Here's who to tell when a note arrives" and "here's who to tell when a line drops". They fill the two empty boxes from the top.

```js
    localPeers: () => peers,
  };
}
```
"Who's on the local Wi-Fi line right now?" End of the big recipe.

```js
module.exports = { createTransport };
```
"Other files may use my `createTransport` recipe." File 9 (`room.js`) is the one that will.

---

# File 9: `app/main/room.js`, the seating chart 🪑

**Its job:** this is the laptop's **room brain**. It uses the mail carrier (file 8) and the front desk (file 7) to:
- **create** a room, **join** one, and **leave**
- keep the **guest list**
- on the host's laptop: keep the **seating chart** (where each screen sits) and work out **who is next to whom**
- remember everyone's **mode**
- give the Control Center one form describing everything, called the **state**

File 9 also changed two older files: the toy remote from file 3 became the **real remote**, and `index.js` got 9 lines of wiring. Both are explained at the end.

New words:

| Word | What it means |
|---|---|
| **State** | One form describing "the situation right now": am I in a room, who's here, where are the screens. The Control Center draws itself from it. |
| **Path** | Which phone line a friend was announced on: `cloud` (sky desk) or `local` (room desk). A friend can be on both. |
| **`async` / `await`** | `async` marks a recipe that has to **wait** for slow things. `await` means "wait here until this is finished, then carry on". |
| **`switch` / `case`** | "Look at this value, and jump to the matching section." `break` = "done with this section". |
| **`? :`** | A short "if": `a ? b : c` = "if a, then b, otherwise c". |
| **IPC** | Messages between the hidden brain and a page (the walkie-talkie from file 4). |

## The top of the file

```js
// Room: create, join and leave a room; keep the member list; on the host, own
// the layout (each laptop's screen as a rectangle) and work out who touches
// whom on each edge. Pushes one state object to the Control Center.
// No Electron in here, so it can be tested with plain `node`.
```
Sticky notes describing the job.

```js
const os = require('os');
const crypto = require('crypto');
```
Borrow two built-in toolboxes: `os` (facts about this computer, like its network addresses) and `crypto` (a good **dice roller** 🎲 for random numbers).

```js
const { createTransport } = require('./transport');
const { start } = require('../server/server');
```
Borrow our own mail-carrier maker (file 8) and the front-desk opener (file 7).

```js
const PATHS = ['cloud', 'local'];
```
A list of the two phone-line names.

```js
// A random string of n digits, leading zeros allowed ("004213").
// Called through `crypto.` so a test can swap the random function.
const digits = (n) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
```
A recipe: "**roll me n random digits**". `10 ** n` = 10 multiplied by itself n times (for 6 digits: one million), so the dice gives a number from 0 to 999999. `padStart(n, '0')` adds zeros at the front if it's too short, so 4213 becomes `004213`.

```js
// This machine's own network addresses (IPv4, not the 127.0.0.1 loopback).
function getLocalIps() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}
```
A recipe: "**what are this laptop's addresses on the Wi-Fi?**" Ask the computer for all its network connections, keep only the normal kind (`IPv4`) that other computers can reach (`!a.internal` = not the "this same computer" address), and hand back just the addresses, like `192.168.137.1`. A friend types one of these to join by IP.

## Who is next to whom

```js
// Neighbours from screen rectangles. B is A's right neighbour when A's right
// side is exactly B's left side and their heights overlap by more than 0;
// same idea for the other edges. Several on one edge: larger overlap wins.
function computeNeighbors(screens) {
```
A recipe that takes the seating chart (a list of rectangles) and works out each screen's neighbour on its four sides.

```js
  const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);
```
A tiny recipe: "**how much do two stretches overlap?**" If one screen goes from 0 to 1080 down the wall and another from 500 to 1580, they share 580. A result of zero or less means they don't overlap.

```js
  const result = {};
  for (const a of screens) {
```
An empty form for the answers. Then, for each screen `a`:

```js
    const best = { left: 0, right: 0, top: 0, bottom: 0 };
    const n = { left: null, right: null, top: null, bottom: null };
```
`best` = the biggest overlap found so far on each side. `n` = the neighbour on each side, all empty to begin with.

```js
    const consider = (edge, touches, amount, id) => {
      if (touches && amount > best[edge]) { best[edge] = amount; n[edge] = id; }
    };
```
A tiny recipe: "**consider this candidate**". If it touches that side, and overlaps more than the best so far, it becomes the neighbour.

```js
    for (const b of screens) {
      if (b.deviceId === a.deviceId) continue;
```
Compare `a` with every other screen `b` (skip itself).

```js
      const vertical = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
      const horizontal = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
```
How much the two share up-and-down, and how much left-to-right.

```js
      consider('right', a.x + a.w === b.x, vertical, b.deviceId);
      consider('left', b.x + b.w === a.x, vertical, b.deviceId);
      consider('bottom', a.y + a.h === b.y, horizontal, b.deviceId);
      consider('top', b.y + b.h === a.y, horizontal, b.deviceId);
    }
```
Four checks:
- `b` is on the **right** if `a`'s right side is exactly where `b`'s left side starts
- `b` is on the **left** if `b`'s right side is exactly where `a` starts
- the same idea for **below** and **above**

```js
    result[a.deviceId] = n;
  }
  return result;
}
```
Write down `a`'s four neighbours, and after all screens are done, hand the answers back.

## Making one room brain

```js
function createRoomManager({ relayUrl, localPort, profile: startProfile }) {
```
Start of the big recipe "make the room brain". It's given the sky desk's address, the door number for the room desk, and this laptop's profile.

```js
  const deviceId = crypto.randomBytes(4).toString('hex');
```
Roll this laptop's **name tag**: 8 random letters and digits, new every time the app starts.

```js
  const profile = { ...startProfile };
  const transport = createTransport(deviceId); // one for the whole life, so mids never restart
```
Keep our own copy of the profile, and make this laptop's one mail carrier.

```js
  let myMode = 'collaborative'; // survives leaving and joining rooms
  let room = null; // null = not in a room
  let server = null; // our embedded room server (host only)
```
Three boxes: my mode (starts as Collaborative), the room I'm in (empty = none), and my own front desk (only the host has one).

```js
  let stopping = Promise.resolve(); // finishes when the last embedded server is fully closed
  let pendingJoin = null; // { roomNumber, pin } while we wait for JOIN_ACCEPTED
  let waiting = null; // one server answer we are waiting for
```
Three more: a promise that's kept when my old front desk has fully closed, the room number and PIN I'm trying to join, and the answer I'm currently waiting for from a desk.

```js
  const stateListeners = [];
  const noticeListeners = [];
```
Two lists of "people to tell": about every change, and about popups.

### Describing the situation (the state)

```js
  // "local" when we talk to that laptop over our local socket, else "relay".
  const pathOf = (id) => (transport.isOpen('local') && (id === deviceId || transport.localPeers().includes(id)) ? 'local' : 'relay');
```
"**How do I reach this friend?**" `local` if my local line is open and the friend is me or is on the local list. Otherwise `relay` (through the sky desk). This is the badge on each card.

```js
  const allModes = () => ({ ...room.modes, [deviceId]: myMode });
```
Everyone's modes, with **my own** written on top. My mode is kept separately so nobody else's note can overwrite it.

```js
  function getState() {
    const ids = room ? [deviceId, ...Object.keys(room.members)] : [];
```
Recipe: "**fill in the state form**". `ids` = me plus every guest, or an empty list if I'm in no room.

```js
    // Through JSON and back, so the caller always gets a fresh plain copy.
    return JSON.parse(JSON.stringify({
```
Build the form, turn it to text and back, so whoever gets it has their **own copy** and can't scribble on ours.

```js
      self: { deviceId, profile },
      isHost: !!room && room.isHost,
      roomNumber: room ? room.roomNumber : null,
      pin: room ? room.pin : null,
      localIps: room ? room.localIps : [],
```
Me, whether I'm the host, and the room number, PIN and addresses (empty when in no room).

```js
      members: ids.map((id) => ({ deviceId: id, profile: id === deviceId ? profile : room.members[id].profile })),
      screens: room ? room.screens : [],
      neighbors: room ? room.neighbors : {},
      modes: room ? allModes() : {},
      transports: Object.fromEntries(ids.map((id) => [id, pathOf(id)])),
      pings: {},
    }));
  }
```
The guest list (name tag and profile for each), the seating chart, the neighbours, the modes, how I reach each friend, and an empty `pings` (filled in a later step). These are the same eleven fields the toy remote in file 3 had.

```js
  const emit = () => stateListeners.forEach((cb) => cb(getState()));
  const notify = (kind, text) => noticeListeners.forEach((cb) => cb({ kind, text }));
```
`emit` = "tell everyone the new situation". `notify` = "show everyone this popup".

### Small helpers

```js
  // Wait for one of `types` from the server on `path`; resolves the message, or null on timeout.
  function waitFor(path, types, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiting = null; resolve(null); }, ms);
      waiting = { path, types, done: (msg) => { clearTimeout(timer); waiting = null; resolve(msg); } };
    });
  }
```
"**Wait for the desk's answer.**" Set an alarm clock for `ms`. Write in the `waiting` box which line and which kinds of answer we're waiting for. If the answer comes, cancel the alarm and hand it over. If the alarm rings first, hand over "nothing" (`null`).

```js
  function makeRoom(fields) {
    return { members: {}, screens: [], neighbors: {}, modes: {}, ...fields };
  }
```
A blank room page: no guests, no screens, no neighbours, no modes, plus whatever fields are given.

```js
  // Host only: recompute neighbours and tell everyone.
  function broadcastLayout() {
    room.neighbors = computeNeighbors(room.screens);
    transport.sendToPeer('*', { type: 'LAYOUT_UPDATED', screens: room.screens, neighbors: room.neighbors });
  }
```
Work out the neighbours again and send everyone the note `LAYOUT_UPDATED` with the chart and the neighbours.

### A friend appears or disappears

```js
  // A member was announced on one path. New to us: add them (and, on the host, place their screen).
  function addPath(id, memberProfile, path) {
    if (id === deviceId) return;
    if (room.members[id]) { room.members[id].paths.add(path); return; }
```
"A desk announced this friend on this line." If it's me, ignore it. If I already know them, just note the extra line and stop.

```js
    room.members[id] = { profile: memberProfile, paths: new Set([path]) };
    room.modes[id] = 'collaborative'; // until their own MODE_UPDATED arrives
    if (!room.isHost) return;
```
A new friend: put them on the guest list with their profile and that one line. Assume Collaborative until they say otherwise. If I'm **not** the host, that's all.

```js
    // To the right of the rightmost screen, top-aligned with it.
    const right = room.screens.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a), { x: 0, y: 0, w: 0 });
```
Host only: find the **rightmost** screen on the chart. (`reduce` = "go through the list keeping one winner".)

```js
    room.screens.push({ deviceId: id, x: right.x + right.w, y: right.y, w: memberProfile.screenWidth, h: memberProfile.screenHeight });
```
Seat the newcomer just to its right, level with its top, at their own screen size.

```js
    broadcastLayout();
    transport.sendToPeer(id, { type: 'ROOM_STATE', screens: room.screens, neighbors: room.neighbors, modes: allModes() });
  }
```
Tell everyone the new chart, and send the newcomer a `ROOM_STATE` note: the chart, the neighbours and everyone's modes, so they're up to date at once.

```js
  // A member left one path. Gone from every path: remove them.
  function dropPath(id, path) {
    const member = room.members[id];
    if (!member) return;
    member.paths.delete(path);
    if (member.paths.size > 0) return;
```
"A desk says this friend left on this line." Cross that line off. If they're **still on the other line**, they're still in the room, so stop.

```js
    delete room.members[id];
    delete room.modes[id];
    if (!room.isHost) return;
    room.screens = room.screens.filter((s) => s.deviceId !== id);
    broadcastLayout();
  }
```
Otherwise remove them from the guest list and the modes. The host also removes their screen (the others stay where they are) and tells everyone.

### Closing my own front desk

```js
  // Close our embedded server, after it has had a moment to tell its clients the room is closed.
  function stopServer() {
    const s = server;
    server = null;
    if (!s) return stopping;
```
If I have no front desk, there's nothing to do.

```js
    const startedAt = Date.now();
    stopping = new Promise((resolve) => {
      const check = () => {
        if (s.clients.size === 0 || Date.now() - startedAt > 500) s.close(() => resolve());
        else setTimeout(check, 20);
      };
      check();
    });
    return stopping;
  }
```
Don't slam the door at once. Check every 20 thousandths of a second: has everyone hung up, or has half a second passed? Then close the desk. That short wait gives the desk time to tell everyone "room closed".

```js
  // The room is over for this laptop: back to "no room" with a notice.
  function endRoom(kind, text) {
    leaveRoom();
    notify(kind, text);
  }
```
Leave, and show a popup saying why.

## When a note arrives

```js
  transport.onMessage((msg, payload, path) => {
```
"Mail carrier, whenever a note arrives, do this."

```js
    // First JOIN_ACCEPTED: set up the room right here, before the host's next message arrives.
    if (msg.type === 'JOIN_ACCEPTED' && !room && pendingJoin) {
      room = makeRoom({ isHost: false, hostId: msg.hostId, ...pendingJoin, localIps: msg.hostLocalIps || [] });
    }
```
If the desk says "you're in" and I was trying to join: make my room page **immediately**, so the host's very next note has somewhere to land.

```js
    if (waiting && waiting.path === path && waiting.types.includes(msg.type)) waiting.done(msg);
    if (!room) return;
```
If this is the answer I was waiting for, hand it to whoever is waiting. If I'm in no room, stop here.

```js
    switch (msg.type) {
      case 'JOIN_ACCEPTED':
        (msg.members || []).forEach((m) => addPath(m.deviceId, m.profile, path));
        break;
      case 'MEMBER_JOINED':
        addPath(msg.member.deviceId, msg.member.profile, path);
        break;
```
Look at the kind of note:
- **"you're in"**: add everyone on the desk's guest list
- **"someone joined"**: add them

```js
      case 'MEMBER_LEFT':
        if (msg.deviceId === deviceId) {
          if (msg.reason === 'kicked') return endRoom('kicked', 'The host removed you from the room');
          return;
        }
        dropPath(msg.deviceId, path);
        break;
```
- **"someone left"**: if it's **me** and the reason is "kicked", the room is over for me, with a popup. Otherwise cross that friend off this line.

```js
      case 'ROOM_CLOSED':
        if (path === 'cloud' && transport.isOpen('local')) return; // the host is still here locally
        return endRoom('room_closed', 'The host closed the room');
```
- **"room closed"**: if the sky desk says so but my local line to the host is still open, ignore it (the host only lost internet). Otherwise the room is over, with a popup.

```js
      case 'LOCAL_PEERS':
        break; // transport already stored them; we only re-push state for the transport badges
```
- **the local list**: the mail carrier already kept it. We only refresh the badges.

```js
      case 'LAYOUT_UPDATED':
      case 'ROOM_STATE':
        if (room.isHost || msg.fromId !== room.hostId) return; // only the host owns the layout
        room.screens = msg.screens || [];
        room.neighbors = msg.neighbors || {};
        if (msg.modes) room.modes = { ...room.modes, ...msg.modes }; // our own mode is kept apart, never overwritten
        break;
```
- **a new chart**: accept it only if it comes from the host. Take the screens and neighbours, and merge in any modes.

```js
      case 'MODE_UPDATED':
        if (msg.deviceId !== msg.fromId || !room.members[msg.deviceId]) return;
        room.modes[msg.deviceId] = msg.mode;
        break;
```
- **"my mode changed"**: accept it only from a known guest speaking about themselves, then note their new mode.

```js
      default:
        return; // not ours (handoff messages come later)
    }
    emit();
  });
```
Any other kind is not for this code (the drag notes come in file 11). After any change, tell everyone the new situation.

```js
  // One of our sockets closed without us asking.
  transport.onClose((path) => {
    if (waiting && waiting.path === path) waiting.done(null);
    if (!room) return;
    if (!PATHS.some(transport.isOpen)) return endRoom('room_closed', 'Connection lost');
    Object.keys(room.members).forEach((id) => dropPath(id, path)); // carry on over the other path
    emit();
  });
```
"Mail carrier, when a line drops by surprise, do this."
- Anyone waiting for an answer on it gets "nothing".
- If **no line is left**, the room is over: popup "Connection lost". The popup is marked as the `room_closed` kind, because that's the kind that makes the Control Center go back to its launch screen.
- Otherwise cross every friend off the dead line (friends only on that line disappear) and carry on with the other one.

## The buttons

### Create a room

```js
  async function createRoom(displayName) {
    leaveRoom();
    await stopping; // the old embedded server must free the port first
    if (displayName) profile.displayName = displayName;
```
Leave any current room, wait until my old front desk has fully closed, and take the name the user typed.

```js
    let roomNumber = digits(6);
    const pin = digits(4);
    const localIps = getLocalIps();
    const createMsg = () => ({ type: 'CREATE_ROOM', roomNumber, pin, hostLocalIps: localIps, localPort, profile });
```
Roll a 6-digit room number and a 4-digit PIN, look up my Wi-Fi addresses, and prepare the "create a room" note.

```js
    // 1. Register with the relay; a number that is taken gets a new one (5 tries).
    let relayOk = false;
    if (await transport.connect('cloud', relayUrl, 3000)) {
      for (let i = 0; i < 5 && !relayOk; i++) {
        if (i > 0) roomNumber = digits(6);
        transport.sendToServer('cloud', createMsg());
        const answer = await waitFor('cloud', ['ROOM_CREATED', 'ROOM_ERROR'], 3000);
        if (!answer) break;
        relayOk = answer.type === 'ROOM_CREATED';
      }
    }
    if (!relayOk) transport.close('cloud');
```
**Step 1, the sky desk.** Dial it (wait up to 3 seconds). If it picks up, ask to create the room, up to 5 times: if it says "taken", roll a new number and ask again. If no answer comes, stop trying. If it didn't work, hang up that line.

```js
    // 2. Start our own server and join it ourselves (direct-IP laptops reach us there).
    let localOk = false;
    server = start({ port: localPort, local: true });
    const listening = await new Promise((resolve) => {
      server.once('listening', () => resolve(true));
      server.once('error', () => resolve(false));
    });
```
**Step 2, my own room desk.** Open it (file 7, with the `local` switch on) and wait to hear whether the door opened or was already taken.

```js
    if (listening && await transport.connect('local', 'ws://127.0.0.1:' + localPort, 3000)) {
      transport.sendToServer('local', createMsg());
      const answer = await waitFor('local', ['ROOM_CREATED', 'ROOM_ERROR'], 3000);
      localOk = !!answer && answer.type === 'ROOM_CREATED';
    }
    if (!localOk) { transport.close('local'); stopServer(); }
```
If it opened: **call my own desk** (`127.0.0.1` = this same computer) and create the same room there. The host must be a guest at its own desk, or friends who join by IP couldn't reach it. If that failed, hang up and close the desk.

```js
    if (!relayOk && !localOk) {
      transport.close('cloud');
      notify('error', 'Could not start a room: no internet and the local port is busy');
      throw new Error('could not start a room');
    }
    if (!relayOk) notify('error', 'No internet: others can join by IP and PIN only');
    if (!localOk) notify('error', 'Local server could not start: others can join over the internet only');
```
- **Both failed**: popup, and give up.
- **Only the sky desk failed**: the room works on the Wi-Fi. Popup: "No internet: others can join by IP and PIN only".
- **Only my desk failed**: the room works through the internet. Popup says so.

```js
    room = makeRoom({ isHost: true, hostId: deviceId, roomNumber, pin, localIps });
    room.screens = [{ deviceId, x: 0, y: 0, w: profile.screenWidth, h: profile.screenHeight }];
    room.neighbors = computeNeighbors(room.screens);
    emit();
    return { roomNumber, pin, localIps };
  }
```
Make my room page with me as host. Put my own screen at the top-left corner of the chart, work out neighbours (none yet), tell everyone, and hand back the number, PIN and addresses for the screen to show.

### Join a room

```js
  async function joinRoom({ roomNumber, pin, displayName, directIp } = {}) {
    leaveRoom();
    if (displayName) profile.displayName = displayName;
```
Leave any current room and take the typed name.

```js
    // Direct IP: straight to the host's own server, no relay at all.
    const path = directIp ? 'local' : 'cloud';
    const url = directIp ? 'ws://' + directIp + ':' + localPort : relayUrl;
    if (!(await transport.connect(path, url, 3000))) return { ok: false, reason: 'unreachable' };
```
If the user typed the host's IP address, dial the **host's own desk** on the local line. Otherwise dial the **sky desk**. If nobody picks up in 3 seconds, answer "no: unreachable".

```js
    pendingJoin = { roomNumber: roomNumber || '', pin }; // by IP the number may be left empty
    transport.sendToServer(path, { type: 'JOIN_ROOM', roomNumber, pin, profile });
    const answer = await waitFor(path, ['JOIN_ACCEPTED', 'JOIN_REJECTED'], 5000);
    pendingJoin = null;
```
Note what I'm trying to join, send "let me in" with the PIN, and wait up to 5 seconds for yes or no.

```js
    if (answer && answer.type === 'JOIN_ACCEPTED' && room) {
      transport.sendToPeer('*', { type: 'MODE_UPDATED', deviceId, mode: myMode });
      emit();
      return { ok: true };
    }
    leaveRoom();
    return { ok: false, reason: answer ? answer.reason : 'unreachable' };
  }
```
- **Yes**: tell everyone my mode, tell the Control Center, answer "ok".
- **No, or silence**: hang up and answer with the desk's reason (`bad_pin`, `no_room`, `full`) or `unreachable`.

### Leave, layout, mode, kick

```js
  // Close everything and go back to "no room". Resolves once our embedded server is closed.
  function leaveRoom() {
    pendingJoin = null;
    PATHS.forEach(transport.close);
    const wasInRoom = !!room;
    room = null;
    const done = stopServer();
    if (wasInRoom) emit();
    return done;
  }
```
Hang up both lines, forget the room, close my front desk if I had one, and (if I really was in a room) tell the Control Center.

```js
  function setLayout(screens) {
    if (!room || !room.isHost || !Array.isArray(screens)) return;
    room.screens = screens.map(({ deviceId: id, x, y, w, h }) => ({ deviceId: id, x, y, w, h }));
    broadcastLayout();
    emit();
  }
```
**Move the screens** (the host dragged cards on the canvas). It's ignored unless I'm the host. Keep only the five fields of each screen, work out neighbours, and tell everyone.

```js
  function setMode(mode) {
    myMode = mode;
    if (room) transport.sendToPeer('*', { type: 'MODE_UPDATED', deviceId, mode });
    emit();
  }
```
**Change my mode.** Remember it, tell everyone in the room, and tell the Control Center.

```js
  function kick(targetDeviceId) {
    if (!room || !room.isHost) return;
    PATHS.forEach((path) => transport.sendToServer(path, { type: 'KICK_MEMBER', targetDeviceId }));
  }
```
**Kick.** Host only: ask **both** desks to remove that laptop.

```js
  function sendDirect(targetDeviceId) {
    console.log('[room] sendDirect to ' + targetDeviceId + ' (not built yet)');
  }
```
**Send to.** Not built yet. It only writes a note in the log.

```js
  return {
    createRoom, joinRoom, leaveRoom, setLayout, setMode, kick, sendDirect, getState,
    onState: (cb) => { stateListeners.push(cb); cb(getState()); },
    onNotice: (cb) => { noticeListeners.push(cb); },
  };
}
```
Hand back the room brain with its buttons. `onState` adds a listener and tells it the current situation straight away. `onNotice` adds a popup listener.

## Connecting the brain to the Control Center

```js
// Connect the manager to the Control Center window: one handler per action,
// and every state and notice pushed to the window (if it is still there).
function wireIpc(ipcMain, getControlWindow, manager) {
  const push = (channel) => (data) => {
    const win = getControlWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
```
A recipe that plugs the room brain into the walkie-talkie 📻. `push` makes a small sender: "if the Control Center window still exists, say this on that channel".

```js
  manager.onState(push('room:state'));
  manager.onNotice(push('room:notice'));
```
Every new situation goes out on the channel `room:state`, and every popup on `room:notice`.

```js
  ipcMain.handle('room:getState', () => manager.getState());
  for (const name of ['createRoom', 'joinRoom', 'leaveRoom', 'setLayout', 'setMode', 'kick', 'sendDirect']) {
    ipcMain.handle('room:' + name, (event, arg) => manager[name](arg));
  }
}
```
Listen for requests from the page: "what's the situation now?", and one channel per button (`room:createRoom`, `room:joinRoom`…). Each just presses the matching button on the room brain and sends back its answer.

```js
module.exports = { createRoomManager, wireIpc, computeNeighbors };
```
What this file shares: the brain maker, the wiring recipe, and the neighbour maths (shared so it can be tested by itself).

## File 3 replaced: `app/main/preload-control.js` is now the real remote 🎮

The toy remote with pretend friends (explained above under File 3) is **gone**. The buttons have the same nine names, but now they are real: each one talks to the room brain over the walkie-talkie.

```js
// window.odyssync for the Control Center (contract.md, "Renderer API").
// Every call goes over IPC to room.js in the main process.
const { contextBridge, ipcRenderer } = require('electron');
```
Sticky notes, then borrow the safe door and the walkie-talkie (same two tools as file 4).

```js
const call = (name) => (arg) => ipcRenderer.invoke('room:' + name, arg);
```
A button-maker: "for a button called `name`, ask the brain on the channel `room:name`, and wait for its answer". `invoke` = "ask and wait for a reply".

```js
contextBridge.exposeInMainWorld('odyssync', {
  createRoom: call('createRoom'),
  joinRoom: call('joinRoom'),
  leaveRoom: call('leaveRoom'),
  setLayout: call('setLayout'),
  setMode: call('setMode'),
  kick: call('kick'),
  sendDirect: call('sendDirect'),
```
Through the safe door, give the page the remote `odyssync` with seven buttons, each made by the button-maker.

```js
  // Every new state, plus the current one right away so the page can draw.
  onState: (cb) => {
    ipcRenderer.on('room:state', (event, state) => cb(state));
    ipcRenderer.invoke('room:getState').then(cb);
  },
```
🔔 "Tell me when anything changes": listen on `room:state`, and also ask for the current situation once, straight away, so the page can draw itself.

```js
  onNotice: (cb) => {
    ipcRenderer.on('room:notice', (event, notice) => cb(notice));
  },
});
```
🔔 "Tell me about popups": listen on `room:notice`. End of the remote.

## The new lines in `index.js` (file 2)

```js
const { app, BrowserWindow, screen, ipcMain } = require('electron');
```
Line 3 now also borrows `ipcMain`, the **brain's end** of the walkie-talkie.

```js
const os = require('os');
const room = require('./room');
const config = require('../config.json');
```
Borrow the computer-facts toolbox, our new `room.js`, and the settings file (the sky desk's address and the door number).

```js
let manager = null;
```
An empty box for the room brain.

```js
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const profile = { displayName: os.hostname(), screenWidth: size.width, screenHeight: size.height, dpiScale: scaleFactor };
```
Inside "when the app has woken up": measure the screen and build this laptop's profile. `os.hostname()` is **the computer's name**, which is how the name box gets pre-filled.

```js
  manager = room.createRoomManager({ relayUrl: config.relayUrl, localPort: config.localPort, profile });
  room.wireIpc(ipcMain, () => controlWin, manager);
```
Make the room brain and plug it into the walkie-talkie for the Control Center window.

```js
app.on('before-quit', () => manager && manager.leaveRoom()); // others see us leave at once
```
"Just before the app quits, leave the room", so friends see this laptop disappear straight away. *(This line was later folded into a bigger quit recipe; see "Two new lines in `index.js`" in the File 10 section.)*

---

# File 10: `app/main/sidecar-bridge.js`, full version, the robot phone 🤖📞

**Its job:** file 6 was a listening post that only wrote things down. This is the grown-up version of the **same file**. It is the link between our app and Tech 1's **Python helper**:
- it still waits for the helper to call on door 8089
- on Windows, it **switches the helper on**, and switches it on again if it stops
- it **hands the helper's messages** to the rest of the app
- it **sends commands** to the helper ("hide that window", "open this address")
- it tells the helper **which screen edges have a neighbour** right now

New words:

| Word | What it means |
|---|---|
| **Process** | A running program. Our app is one process, and the Python helper is another. |
| **Spawn** | Start another program from inside ours. |
| **Kill** | Tell a running program to stop. |
| **Stream** | A pipe that text flows through, a bit at a time. What the Python helper prints comes to us through one. |

```js
// Sidecar bridge: the link between the app and the Python sidecar.
// It listens on ws://127.0.0.1:8089 (the sidecar connects to us), starts the
// sidecar program on Windows and starts it again if it dies, hands the
// sidecar's messages to the app, sends commands back, and tells the sidecar
// which screen edges have a neighbour right now (SET_ACTIVE_EDGES).
```
Sticky notes describing the job.

```js
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { WebSocketServer } = require('ws');
```
Borrow four toolboxes: files 📂, addresses 🗺️, the **program starter** (`child_process`), and the phone-exchange maker.

```js
const REPO_ROOT = path.join(__dirname, '..', '..');
const DAEMON = path.join(REPO_ROOT, 'sidecar', 'win32_daemon.py');
const RESTART_MS = 2000;
```
Three fixed facts: where the project's top folder is (two folders up from this file), where Tech 1's helper file lives (`sidecar/win32_daemon.py`), and "wait 2 seconds before restarting".

## The bridge's memory

```js
let server = null; // the WebSocket server
let sidecar = null; // the one connected sidecar socket, or null
let child = null; // the Python process we started, or null
```
Three boxes: the phone exchange, the helper's open phone line, and the helper program we started.

```js
let restartTimer = null; // waiting to start Python again
let stopped = false; // true after stop(): never restart again
let callback = null; // the app's onMessage function
```
Three more: the alarm clock for a restart, a "we're shutting down" flag, and who to tell when a message arrives.

```js
let edges = { left: false, right: false, top: false, bottom: false };
let lastSentEdges = null; // what this connection last got, as text
```
Which of my four edges have a neighbour (none at first), and what I last told the helper about them.

## Telling the helper about edges

```js
// Send the remembered edges, but only if this connection has not had them yet.
function sendEdges() {
  const msg = { type: 'SET_ACTIVE_EDGES', ...edges };
  const text = JSON.stringify(msg);
  if (text !== lastSentEdges && send(msg)) lastSentEdges = text;
}
```
Build the note `SET_ACTIVE_EDGES` with the four yes/no answers. Send it **only if it's different** from the last one sent, and remember it if it went out. The room's situation changes often, so this stops the same note being sent over and over.

## A message from the helper

```js
// One message from the sidecar: log it (not the 60-per-second ones), then pass it on.
function handleMessage(data, isBinary) {
  if (!isBinary) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { msg = null; }
```
For a text message: try to read it as a form. If it can't be read, `msg` is "nothing".

```js
    if (!msg || typeof msg !== 'object') {
      console.log('[sidecar] bad message, ignored: ' + data.toString().slice(0, 200).replace(/\s+/g, ' '));
      return;
    }
```
Not a proper form: write down the first 200 letters (`slice(0, 200)`) on one line, and stop.

```js
    if (msg.type !== 'LOCAL_DRAG_MOVE') console.log('[sidecar] ' + JSON.stringify(msg));
    if (callback) callback(msg, null);
    return;
  }
```
Write the message in the log, **except** `LOCAL_DRAG_MOVE`. That one arrives 60 times a second during a drag and would flood the log. Then hand the message to the app (with "no parcel contents").

```js
  // Binary message: [uint32 LE header length][JSON header][payload bytes].
  let header, payload;
  try {
    const headerLength = data.readUInt32LE(0);
    if (4 + headerLength > data.length) throw new Error('header longer than frame');
    header = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
    if (!header || typeof header !== 'object') throw new Error('header is not an object');
    payload = data.subarray(4 + headerLength);
  } catch (err) {
    console.log('[sidecar] bad binary frame (' + data.length + ' bytes): ' + err.message);
    return;
  }
  if (callback) callback(header, payload);
}
```
For a **parcel** 📦 (the window's picture): read the label and keep the contents, the same way as in file 8. A broken parcel is written down and dropped. A good one is handed to the app: label and picture.

## Reading what Python prints

```js
// Print what Python writes, one line at a time, so its output reads cleanly in our log.
function pipeLines(stream) {
  let rest = '';
  stream.on('data', (chunk) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/);
    rest = lines.pop(); // the last piece may be half a line: keep it for later
    lines.forEach((line) => console.log('[sidecar py] ' + line));
  });
  stream.on('end', () => { if (rest) console.log('[sidecar py] ' + rest); rest = ''; });
}
```
The helper's printed text arrives in pieces that may be cut mid-line. This recipe glues each new piece onto the leftover from last time, splits it into whole lines (`split`), keeps the last unfinished piece for later (`pop` = "take the last one off"), and writes each whole line in our log with `[sidecar py]` in front. When the pipe ends, it writes any leftover.

## Switching the helper on

```js
// Start Python with the sidecar script; when it ends or cannot start, try again in 2 s.
function startProcess() {
  restartTimer = null;
  if (stopped) return;
  console.log('[sidecar] starting python ' + DAEMON);
```
Clear the alarm clock box. If we're shutting down, do nothing. Otherwise log "starting python".

```js
  const proc = childProcess.spawn('python', [DAEMON], {
    cwd: REPO_ROOT,
    windowsHide: true, // no console window
    env: { ...process.env, PYTHONUNBUFFERED: '1' }, // Python prints at once, not in big chunks
  });
  child = proc;
```
**Start the program** `python` with Tech 1's file:
- `cwd` = "run it from the project's top folder"
- `windowsHide: true` = **no black window pops up**, so the helper is invisible
- `env ... PYTHONUNBUFFERED` = a setting that makes Python print each line right away instead of saving them up

Then put the running program in the `child` box.

```js
  pipeLines(proc.stdout);
  pipeLines(proc.stderr);
```
Read both of the helper's pipes: its normal printing (`stdout`) and its error printing (`stderr`).

```js
  let ended = false;
  const finish = (why) => {
    if (ended) return; // 'error' and 'exit' can both come for one process
    ended = true;
    if (child === proc) child = null;
    console.log('[sidecar] python ' + why + (stopped ? '' : ', starting it again in 2 s'));
    if (!stopped) restartTimer = setTimeout(startProcess, RESTART_MS);
  };
```
The "**the helper stopped**" recipe. Do it only once per run. Empty the `child` box, log why, and unless we're shutting down, set the alarm clock: "in 2 seconds, start it again".

```js
  proc.on('error', (err) => finish('could not start: ' + err.message));
  proc.on('exit', (code, signal) => finish('exited (' + (signal || 'code ' + code) + ')'));
}
```
Two ways it can stop: it **couldn't start** (for example Python isn't installed), or it **ended** (crashed or quit). Both lead to the recipe above.

## Opening the bridge

```js
function start() {
  server = new WebSocketServer({ host: '127.0.0.1', port: 8089 });

  // A failed listen (most often: another copy of the app holds the port) lands here.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('[sidecar] port 8089 is busy, bridge not started (is another copy of Odyssync running?)');
    } else {
      console.log('[sidecar] bridge error: ' + err.message);
    }
  });
```
Same as file 6: open the phone exchange on this computer at door 8089. If the door is taken, log one line and carry on.

```js
  // Start Python only once we own the port, so two copies never start two sidecars.
  server.on('listening', () => {
    if (process.platform !== 'win32') console.log('[sidecar] not Windows, sidecar not started');
    else if (!fs.existsSync(DAEMON)) console.log('[sidecar] file not found, sidecar not started: ' + DAEMON);
    else startProcess();
  });
```
"Once the door is really open":
- not on Windows → log it, start nothing (the helper only works on Windows)
- Tech 1's file isn't there yet → log it, start nothing
- otherwise → switch the helper on

Doing this only after the door opens means a second copy of the app never starts a second helper.

```js
  server.on('connection', (socket) => {
    // Only one sidecar at a time: a new one replaces the old one, quietly.
    if (sidecar) { const old = sidecar; sidecar = null; old.terminate(); }
    sidecar = socket;
    lastSentEdges = null;
    console.log('[sidecar] connected');
```
"When a helper calls": if one was already connected, cut the old line. Keep the new one, forget what the old one was told about edges, and log "connected".

```js
    socket.on('close', () => {
      if (socket !== sidecar) return; // an old, replaced socket: not our news
      sidecar = null;
      console.log('[sidecar] disconnected');
    });
    socket.on('error', (err) => console.log('[sidecar] socket error: ' + err.message));
    socket.on('message', (data, isBinary) => { if (socket === sidecar) handleMessage(data, isBinary); });
    sendEdges();
  });
}
```
- when this line closes (and it's still the current one): empty the box, log "disconnected"
- a problem on the line is written down
- a message on the current line goes to the `handleMessage` recipe
- and straight away, **tell the new helper which edges have neighbours**

## Shutting down, sending, and the public buttons

```js
// For app quit: no more restarts, close the link, then end Python.
// Closing the link makes the sidecar show again any window it had hidden,
// so if Python is running we give it 500 ms for that before we end it.
// done (optional) is called when all of this is finished.
function stop(done) {
  stopped = true;
  clearTimeout(restartTimer);
  restartTimer = null;
```
For when you quit Odyssync. `done` = an optional "tell me when you've finished" phone number. First: raise the "shutting down" flag and cancel any restart alarm.

```js
  if (sidecar) { const s = sidecar; sidecar = null; s.terminate(); }
  if (server) { server.close(); server = null; }
```
**Cut the helper's phone line and close the exchange.** This comes first on purpose: when Tech 1's helper notices the line is gone, it **shows again any window it had hidden**. That's the safety net for a handoff that was still waiting for its answer.

```js
  const proc = child;
  if (!proc) { if (done) done(); return; } // no Python running: nothing to wait for
```
If we never started a Python helper (for example on a Mac), there's nothing to wait for: say "finished" straight away.

```js
  setTimeout(() => {
    if (child === proc) { proc.kill(); child = null; } // still running: end it now
    if (done) done();
  }, 500);
}
```
Otherwise **wait half a second**, so the helper has time to put hidden windows back. Then stop the helper (if it's still the same one, still running) and say "finished". Nothing is left running in the background, and no window stays hidden.

```js
// Send one JSON message to the sidecar. false if no sidecar is connected.
function send(msg) {
  if (!sidecar || sidecar.readyState !== sidecar.OPEN) return false;
  sidecar.send(JSON.stringify(msg));
  return true;
}
```
**Send a command to the helper.** If no helper is connected, answer `false`. Otherwise send it and answer `true`.

```js
function setActiveEdges(e) {
  edges = { left: !!e.left, right: !!e.right, top: !!e.top, bottom: !!e.bottom };
  sendEdges();
}
```
**Remember which edges have neighbours** (each as a plain yes or no) and tell the helper if it changed.

```js
module.exports = {
  start,
  stop,
  send,
  onMessage: (cb) => { callback = cb; },
  isConnected: () => sidecar !== null,
  setActiveEdges,
};
```
The buttons other files may use: start, stop, send, "tell me when a message arrives", "is a helper connected?", and set the edges.

## One new recipe in `room.js` (file 9)

```js
// Which of THIS laptop's edges have a neighbour, from a getState() object.
// A neighbour counts only while it is still in the member list.
function activeEdges(state) {
  const mine = (state.neighbors || {})[state.self.deviceId] || {};
  const ids = (state.members || []).map((m) => m.deviceId);
  const has = (edge) => !!mine[edge] && ids.includes(mine[edge]);
  return { left: has('left'), right: has('right'), top: has('top'), bottom: has('bottom') };
}
```
From the state form, work out my four edges:
- `mine` = my own row in the neighbours table (or an empty form)
- `ids` = the name tags of everyone on the guest list
- `has(edge)` = "is there a neighbour on that edge, **and** is that neighbour on my guest list?"

A screen that's on the chart but that I can't actually reach doesn't count.

## Two new lines in `index.js` (file 2)

```js
  manager.onState((state) => sidecarBridge.setActiveEdges(room.activeEdges(state)));
```
"Every time the room's situation changes, work out my edges and tell the bridge." This is how the Python helper learns where neighbours are, so it only watches those edges.

```js
let quitting = false; // true once the tidy-up has started
let tidied = false; // true once it has finished: now the app may really quit
```
*(Changed after the whole-project review. These lines replace the two older "before the app quits" lines, including the one in the File 9 section.)* Two yes/no boxes: "have we started tidying up?" and "have we finished?".

```js
app.on('before-quit', (e) => {
  if (tidied) return;
  e.preventDefault(); // wait: the sidecar may need a moment to show hidden windows
  if (quitting) return; // a second quit request while we wait: keep waiting
  quitting = true;
```
"Just before the app quits":
- if the tidy-up is finished, let the quit go ahead
- otherwise **hold the quit** (`preventDefault` = "don't do the usual thing yet")
- if tidying has already started (someone pressed quit twice), just keep waiting
- otherwise note that tidying has started

```js
  const finish = () => { tidied = true; setImmediate(() => app.quit()); };
```
A tiny recipe for "we're done": mark it finished, and ask the app to quit again in a moment (`setImmediate` = "right after this"). This time the quit goes through.

```js
  try { if (manager) manager.leaveRoom(); } catch (err) { console.log('[app] leave on quit failed: ' + err.message); } // others see us leave at once
  try { sidecarBridge.stop(finish); } catch (err) { console.log('[app] sidecar stop failed: ' + err.message); finish(); }
});
```
Leave the room (so friends see this laptop disappear at once), then shut the bridge down and call `finish` when it's done. Each step is inside a `try`, so even if one fails, the app still quits and never hangs.

---

# File 11: `app/main/handoff.js`, the traffic lights 🚦

**Its job:** this is the heart of Odyssync: the rules for **handing a browser window to a neighbour**. One file plays both parts:
- 📤 **Sender**: "my Python helper says I'm dragging a window to an edge." It tells the neighbour, and decides what happens to my window.
- 📥 **Receiver**: "a neighbour is sending me a window." It shows the sliding picture, opens the real window, and answers the sender.

The most important rule is that **a tab is never lost**. The sender only **hides** its window. It **closes** it only after the receiver confirms the tab really opened. If anything goes wrong, the hidden window comes back.

New words:

| Word | What it means |
|---|---|
| **Transfer** | One handoff of one window. Each gets its own tracking number, the `transferId`. |
| **Ghost** | The sliding **picture** of the window on the receiver's screen, before the real window opens. |
| **Commit** | The moment the sender **lets go at the edge**: "it's yours now". |
| **Physical pixels** | The screen's real tiny dots. The Python helper counts in these. |
| **DIPs** | (From the first dictionary.) Zoom-proof dots. The network and the overlay count in these. |
| **Throttle** | "Not more often than…" Slowing down how often something is sent. |
| **Map** | A lookup book: give it a key (like a tracking number), get back what's stored. |
| **hwnd** | Windows' own ID number for one window. The Python helper uses it to say *which* window. |

## The top of the file

```js
// Handoff: the tab-handoff state machine (plan/contract.md, "Sender rules" and
// "Receiver rules"). As SENDER it turns this laptop's sidecar drag reports into
// network messages and overlay events; as RECEIVER it turns other laptops'
// messages into overlay events and sidecar commands, and answers the sender.
// Units: the sidecar speaks physical pixels; the network and the overlay use
// DIPs. Network `edge` is always the sender's edge; overlay events get THIS
// screen's edge. No Electron in here, so it can be tested with plain `node`.
```
Sticky notes with the job and two rules to remember: **pixels vs DIPs**, and **whose edge** (on the network it's always the sender's edge; on a screen it's that screen's own edge).

```js
const crypto = require('crypto');
```
Borrow the dice roller 🎲, for tracking numbers.

```js
const MOVE_MS = 16; // EDGE_DRAG_MOVE at most once per 16 ms
const MAX_BUFFERED = 64 * 1024; // bytes waiting on the socket before we hold moves back
```
Two limits for drag notes: at most one every 16 thousandths of a second (about 60 a second), and "the line is backed up" means more than about 64,000 bytes are waiting to go out.

```js
const DEFAULT_TIMEOUTS = {
  reply: 5000, // sender: no answer in 5 s -> window comes back
  replyApproval: 35000, // the same, when the receiver is in approval mode
  approval: 30000, // receiver: no Accept/Reject in 30 s -> rejected
  ghost: 500, // receiver: wait this long for the overlay's ghostSettled (its animation takes about 0.26 s)
  open: 4300, // receiver: wait for the sidecar's answer (it tries for 4 s); ghost + this stays under the sender's 5 s
};
```
All the waiting times, in thousandths of a second:
- **5 s**: the sender waits this long for an answer, then takes its window back
- **35 s**: the same, when the receiver must click Accept first
- **30 s**: how long the Accept/Reject card waits for a click
- **0.5 s**: how long the receiver waits for the overlay to say where the picture stopped (the animation takes about a quarter of a second)
- **4.3 s**: how long the receiver waits for the real window to open (Tech 1's Python helper itself keeps trying for 4 s, so we wait a little longer than that)

0.5 s + 4.3 s is less than the sender's 5 s. So the receiver always gives up **before** the sender does, and the two never disagree about who has the tab.

```js
const OPPOSITE = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' };
```
A lookup for flipping edges: what leaves the sender's RIGHT arrives on the receiver's LEFT.

## Making the handoff brain

```js
// ctx = { transport, getState, bridge?, overlay?, timeouts? }
function createHandoff(ctx) {
  const { transport, getState } = ctx;
```
Start of the big recipe. It's handed the mail carrier (file 8) and the "what's the situation?" recipe from the room brain (file 9).

```js
  const bridge = ctx.bridge || { send: () => false, onMessage: () => {}, isConnected: () => false };
  const overlay = ctx.overlay || { send: () => {}, onAnswer: () => {}, onGhostSettled: () => {} };
  const times = { ...DEFAULT_TIMEOUTS, ...ctx.timeouts };
```
It's also handed the robot phone (`bridge`, file 10) and the glass window (`overlay`). If either is missing, use a **dummy** that does nothing, so the code never trips. `times` = the waiting times above (tests may shorten them).

```js
  let sidecarDpi = null; // dpiScale from SIDECAR_READY, once it has arrived
  let drag = null; // our one drag in progress: { hwnd, browser, url, title, preview, transfer }
  const waiting = new Map(); // transferId -> our committed transfer, waiting for an answer
  const incoming = new Map(); // transferId -> a transfer coming to us
```
The memory:
- the screen zoom the Python helper reported
- **my one drag** in progress (a person drags one window at a time)
- a lookup book of windows I've **sent and am waiting to hear about**
- a lookup book of windows **coming to me**

### Small helpers

```js
  const selfId = () => getState().self.deviceId;
  const myProfile = () => getState().self.profile;
```
"My name tag" and "my profile".

```js
  const dpi = () => sidecarDpi || myProfile().dpiScale || 1;
  const toDip = (px) => px / dpi();
  const toPx = (dip) => Math.round(dip * dpi());
```
My screen zoom (the Python helper's number if we have it, otherwise the app's, otherwise 1). Then the two converters: **pixels → DIPs** = divide by the zoom, and **DIPs → pixels** = multiply and round to a whole dot. Example: on a 125% screen, 1000 pixels is 800 DIPs.

```js
  const modeOf = (id) => getState().modes[id] || 'collaborative';
  const isMember = (id) => id !== selfId() && getState().members.some((m) => m.deviceId === id);
```
"What mode is this laptop in?" and "is this laptop on my guest list (and not me)?" (`some` = "is there at least one that matches?")

```js
  const nameOf = (id) => {
    const m = getState().members.find((x) => x.deviceId === id);
    return m ? m.profile.displayName : '';
  };
```
"What's this laptop's display name?"

```js
  const dataUrl = (mime, bytes) => 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64');
```
Turn a picture's raw bytes into a **picture written as text** (a `data:` address, like the fake one in file 5), so the overlay page can show it.

```js
  // One event to our own overlay. Every event has type, role, edge, transferId.
  const show = (type, role, edge, transferId, fields) => overlay.send({ type, role, edge, transferId, ...fields });
```
"**Tell my glass window something.**" Every message has the same four first fields as in file 5.

```js
  // The member next to us on this edge ("RIGHT"), or null. Seating chart AND member list.
  function neighbourOn(edge) {
    const state = getState();
    const id = ((state.neighbors || {})[state.self.deviceId] || {})[edge.toLowerCase()];
    return id && isMember(id) ? id : null;
  }
```
"**Who is next to me on this edge?**" Look in my row of the neighbours table. They only count if they're also on my guest list.

```js
  // Which of OUR edges faces this sender: from the seating chart, else the
  // opposite of the sender's edge, else LEFT.
  function myEdgeFacing(fromId, senderEdge) {
    const state = getState();
    const mine = (state.neighbors || {})[state.self.deviceId] || {};
    const found = ['left', 'right', 'top', 'bottom'].find((e) => mine[e] === fromId);
    if (found) return found.toUpperCase();
    return OPPOSITE[senderEdge] || 'LEFT';
  }
```
"**Which of my edges does this sender come in from?**" Look for them in my neighbours. If they're not there, flip the sender's edge. If that's unknown too, say LEFT.

# 📤 The sender's part

```js
  // The drag left the edge, or was released away from it: tell the receiver, clear our overlay.
  function cancelOutgoing(t) {
    clearTimeout(t.moveTimer);
    transport.sendToPeer(t.target, { type: 'EDGE_DRAG_CANCEL', transferId: t.id });
    show('CANCEL', 'sender', t.edge, t.id);
    if (drag && drag.transfer === t) drag.transfer = null;
  }
```
**"Never mind."** Cancel any drag note waiting to go, tell the neighbour `EDGE_DRAG_CANCEL` (their picture slides away), tell my own glass, and forget this transfer.

```js
  // Forward the stored preview picture to the receiver and show it on our overlay.
  function sendPreview(t, preview) {
    const { mime, width, height, bytes } = preview;
    transport.sendBinaryToPeer(t.target, { type: 'WINDOW_PREVIEW_FRAME', transferId: t.id, mime, width, height }, bytes);
    show('PREVIEW', 'sender', t.edge, t.id, { imageUrl: dataUrl(mime, bytes) });
  }
```
**Send the window's photo** to the neighbour as a parcel 📦, and show it on my own glass too.

```js
  // Send the newest move, but at most once per 16 ms and not while the line is
  // backed up. A move that has to wait is sent later by one timer, and a newer
  // move that arrives meanwhile simply replaces it (t.lastMove is always the newest).
  function forwardMove(t) {
    if (t.moveTimer) return; // a send is already booked; it will take the newest move
```
**Send "it moved"**, throttled. If a send is already booked, do nothing: it will pick up the newest position when it fires.

```js
    const wait = t.lastSentAt + MOVE_MS - Date.now();
    const backedUp = transport.bufferedAmount(t.target) > MAX_BUFFERED;
```
How long until 16 thousandths of a second have passed since the last send? And is the line backed up?

```js
    if (wait > 0 || backedUp) {
      t.moveTimer = setTimeout(() => { t.moveTimer = null; forwardMove(t); }, wait > 0 ? wait : MOVE_MS);
      return;
    }
```
If it's too soon or the line is busy: set an alarm clock to try again shortly, and stop. Old positions are never queued; only the newest is kept.

```js
    t.lastSentAt = Date.now();
    transport.sendToPeer(t.target, { type: 'EDGE_DRAG_MOVE', transferId: t.id, ...t.lastMove });
  }
```
Otherwise note the time and send the newest position.

### The Python helper says: a drag started

```js
  function onDragStart(msg) {
    if (drag && drag.transfer) cancelOutgoing(drag.transfer); // the old drag never ended
    drag = null;
    if (msg.tabCount !== 1 || !msg.url) return; // several tabs, or no URL: ignore the whole drag (E4.9)
    drag = { hwnd: msg.hwnd, browser: msg.browser, url: msg.url, title: msg.title, preview: null, transfer: null };
  }
```
Clean up any old drag. If the window has **more than one tab**, or no web address could be read, **ignore this drag completely**. Otherwise remember it: which window, which browser, its address and title. There's no transfer yet, because the window isn't at an edge.

### The helper sends the window's photo

```js
  function onPreview(header, bytes) {
    if (!drag || !bytes) return;
    drag.preview = { mime: header.mime, width: toDip(header.width), height: toDip(header.height), bytes };
    if (drag.transfer) sendPreview(drag.transfer, drag.preview);
  }
```
Keep the photo (its size converted to DIPs). If a transfer is already under way, send it now. Otherwise it's sent when the transfer starts.

### The helper says: the window moved

```js
  function onDragMove(msg) {
    if (!drag) return;
    const edge = msg.edge || null;
    const target = edge ? neighbourOn(edge) : null;
    let t = drag.transfer;
```
Which edge is the window near (or none)? Who's the neighbour there (or nobody)? And `t` = the transfer in progress, if any.

```js
    // Left the edge, moved to another edge, or the neighbour changed: cancel (rule 2).
    if (t && (t.edge !== edge || t.target !== target)) { cancelOutgoing(t); t = null; }
    if (!target) return; // no edge, or no neighbour on it: nothing at all (E4.8)
```
If a transfer was going and the window has left that edge (or the neighbour changed): cancel it. If there's no neighbour here, **do nothing at all**.

```js
    if (!t) {
      // Rule 1: entering an edge with a neighbour starts a new transfer.
      const { hwnd, url, title, browser } = drag;
      t = { id: crypto.randomUUID(), target, edge, hwnd, url, title, browser, lastMove: null, lastSentAt: 0, moveTimer: null, timer: null };
      drag.transfer = t;
      if (drag.preview) sendPreview(t, drag.preview);
    }
```
**Rule 1.** The window just reached an edge with a neighbour: start a new transfer with a fresh tracking number (`randomUUID` = a long random ID), remember who it's for, and send the photo if we have it.

```js
    t.lastMove = {
      edge,
      protrusionPx: toDip(msg.protrusionPx),
      centerRatio: msg.centerRatio, // a 0..1 ratio: never converted
      width: toDip(msg.width),
      height: toDip(msg.height),
    };
```
Note the newest position, converted from pixels to DIPs. `centerRatio` (how far along the edge, 0 to 1) is a share, not a size, so it isn't converted.

```js
    forwardMove(t);
    const { protrusionPx, centerRatio, width, height } = t.lastMove;
    show('DRAG_MOVE', 'sender', edge, t.id, { protrusionPx, centerRatio, width, height, mode: modeOf(target) });
  }
```
Send it to the neighbour (throttled), and tell my own glass, including the **receiver's mode** (that colours the glow on my edge).

### The helper says: the mouse was released

```js
  function onDragEnd(msg) {
    if (!drag) return;
    const t = drag.transfer;
    drag = null;
    if (!t) return;
    clearTimeout(t.moveTimer);
```
The drag is over. If no transfer was going, there's nothing to do.

```js
    if (!(msg.cursorAtEdge === true && msg.edge === t.edge)) return cancelOutgoing(t); // rule 2
```
**Rule 2.** If the mouse was **not** touching the edge when released: cancel. The window stays with me.

```js
    const receiverMode = modeOf(t.target);
    if (receiverMode === 'focus') {
      // Rule 3: the window bounces back, and the receiver only hears a cancel.
      bridge.send({ type: 'BOUNCE_WINDOW', hwnd: t.hwnd, edge: t.edge });
      transport.sendToPeer(t.target, { type: 'EDGE_DRAG_CANCEL', transferId: t.id });
      show('BOUNCE', 'sender', t.edge, t.id);
      return;
    }
```
**Rule 3.** The neighbour is in **Focus** (do not disturb): tell my Python helper to bounce the real window back onto my screen, tell the neighbour "cancel", and tell my glass to play the bounce. Nothing is sent.

```js
    // Rule 4: hide (not close) our window and ask the receiver to open the tab.
    const { centerRatio, width, height } = t.lastMove;
    bridge.send({ type: 'HIDE_WINDOW', hwnd: t.hwnd });
```
**Rule 4.** Otherwise: tell my Python helper to **hide** my window. It's hidden, not closed.

```js
    transport.sendToPeer(t.target, {
      type: 'TRANSFER_COMMIT', transferId: t.id, kind: 'tab', edge: t.edge, centerRatio, width, height,
      url: t.url, title: t.title, browser: t.browser, direct: false,
    });
```
Send the neighbour `TRANSFER_COMMIT`: "it's yours". The note has the web address, title, browser, and where and how big the window was.

```js
    show('COMMIT', 'sender', t.edge, t.id, {
      kind: 'tab', title: t.title, url: t.url, filename: null, size: null,
      fromName: myProfile().displayName, mode: modeOf(selfId()), direct: false,
    });
```
Tell my own glass, so it can whip the picture off the edge.

```js
    waiting.set(t.id, t);
    // The return-the-tab timer: no answer in time -> the window comes back.
    const ms = receiverMode === 'approval' ? times.replyApproval : times.reply;
    t.timer = setTimeout(() => finishOutgoing(t, 'FAILED'), ms);
  }
```
Put the transfer in the "waiting to hear back" book and set the **safety alarm clock**: 5 seconds (35 if the neighbour must click Accept). If it rings, the window comes back.

```js
  // A waiting transfer is over: close our window (accepted) or bring it back.
  function finishOutgoing(t, result) {
    clearTimeout(t.timer);
    waiting.delete(t.id);
    bridge.send({ type: result === 'PLACED' ? 'CLOSE_WINDOW' : 'SHOW_WINDOW', hwnd: t.hwnd });
    show(result, 'sender', t.edge, t.id);
  }
```
**The ending.** Cancel the alarm clock and take the transfer out of the book. If the result is `PLACED` (the tab really opened over there), tell the helper to **close** my hidden window. For any other result, tell it to **show** the window again. Then tell my glass.

```js
  // An answer from the receiver: only from that receiver, only while we still wait.
  function onReply(msg) {
    const t = waiting.get(msg.transferId);
    if (!t || msg.fromId !== t.target) return;
    if (msg.type === 'TRANSFER_ACCEPTED') finishOutgoing(t, 'PLACED'); // rule 5
    else if (msg.type === 'TRANSFER_REJECTED') finishOutgoing(t, 'REJECTED'); // rule 6
    else finishOutgoing(t, 'FAILED'); // rule 6
  }
```
**Rules 5 and 6.** An answer arrives. It's ignored unless we're still waiting for that tracking number and it comes from the right laptop. "Accepted" closes my window. "Rejected" or "failed" brings it back. An answer that comes after the alarm already rang is ignored, so a window that came back is never closed.

# 📥 The receiver's part

```js
  // Our record of one incoming transfer (made on its first message).
  // stage: 'drag' (ghost following) -> 'approval' -> 'ghost' -> 'opening'.
  function incomingFor(id, fromId, senderEdge) {
    let r = incoming.get(id);
    if (!r) {
      r = { id, from: fromId, edge: myEdgeFacing(fromId, senderEdge), stage: 'drag', commit: null, rect: null, timer: null };
      incoming.set(id, r);
    }
    return r;
  }
```
Find my record for this tracking number, or start one: who it's from, which of my edges it comes in on, and its **stage**. The stages go: `drag` (picture following) → `approval` (waiting for a click) → `ghost` (waiting to hear where the picture stopped) → `opening` (waiting for the real window).

```js
  const reply = (r, fields) => transport.sendToPeer(r.from, { transferId: r.id, ...fields });
```
"Answer the sender" about this transfer.

```js
  // This incoming transfer is over: clear its timer and forget it.
  function forget(r) {
    clearTimeout(r.timer);
    incoming.delete(r.id);
  }

  // End an incoming transfer with an overlay event and an answer to the sender.
  function endIncoming(r, overlayType, answer) {
    forget(r);
    show(overlayType, 'receiver', r.edge, r.id);
    reply(r, answer);
  }
```
`forget` = cancel its alarm clock and remove the record. `endIncoming` = forget it, tell my glass how it ended, and answer the sender.

### Where should the real window open?

```js
  // Our screen size in DIPs, and a box clamped to stay fully on it.
  function clampRect({ x, y, width, height }) {
    const { screenWidth: W, screenHeight: H } = myProfile();
    const w = Math.min(width, W);
    const h = Math.min(height, H);
    return { x: Math.min(Math.max(x, 0), W - w), y: Math.min(Math.max(y, 0), H - h), width: w, height: h };
  }
```
**"Keep this box fully on my screen."** Make it no bigger than the screen, and push it back in if it pokes over any side.

```js
  // No ghostSettled from the overlay: flush against our edge, centred at centerRatio along it.
  function computedRect(r) {
    const { screenWidth: W, screenHeight: H } = myProfile();
    const { width, height, centerRatio } = r.commit;
    const w = Math.min(width, W);
    const h = Math.min(height, H);
    const along = (size, len) => centerRatio * len - size / 2;
```
The **backup plan** if the glass never says where the picture stopped. Take the window's size from the commit note. `along` works out where the box should start so its middle sits at the same share of the edge as on the sender's screen.

```js
    if (r.edge === 'LEFT') return clampRect({ x: 0, y: along(h, H), width: w, height: h });
    if (r.edge === 'RIGHT') return clampRect({ x: W - w, y: along(h, H), width: w, height: h });
    if (r.edge === 'TOP') return clampRect({ x: along(w, W), y: 0, width: w, height: h });
    return clampRect({ x: along(w, W), y: H - h, width: w, height: h });
  }
```
Put the box right against the edge it came in from: left, right, top or bottom.

```js
  // Wait (up to 0.5 s) for the overlay to say where the ghost ended, then open the tab.
  function waitForGhost(r) {
    if (r.rect) return openTab(r); // it already arrived
    r.stage = 'ghost';
    r.timer = setTimeout(() => openTab(r), times.ghost);
  }
```
If the glass already reported where the picture stopped, open the tab now. Otherwise wait up to half a second, then open it anyway.

```js
  // Ask our sidecar to open the URL at the ghost's spot (physical pixels).
  function openTab(r) {
    clearTimeout(r.timer);
    const rect = clampRect(r.rect || computedRect(r));
    const sent = bridge.send({
      type: 'OPEN_URL', transferId: r.id, url: r.commit.url, browser: r.commit.browser,
      x: toPx(rect.x), y: toPx(rect.y), width: toPx(rect.width), height: toPx(rect.height),
    });
```
**Open the real window.** Use the reported spot, or the backup plan. Tell my Python helper `OPEN_URL`: the address, the browser, and the spot converted from DIPs to **my** screen's pixels.

```js
    if (!sent) return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'no sidecar' });
    r.stage = 'opening';
    r.timer = setTimeout(() => endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'timeout' }), times.open);
  }
```
If there's no helper to tell, fail at once so the sender gets its window back. Otherwise the stage is `opening`, with an alarm clock: if the helper hasn't confirmed in 4.3 seconds, fail.

### The sender let go: `TRANSFER_COMMIT` arrives

```js
  function onCommit(msg) {
    const hadGhost = incoming.has(msg.transferId);
    const r = incomingFor(msg.transferId, msg.fromId, msg.edge);
    if (r.commit) return; // the same commit twice: already handled
    r.commit = msg;
    const myMode = modeOf(selfId());
```
Find or start the record, and keep the commit note. Then look at **my own mode**:

```js
    if (myMode === 'focus') {
      // Receiver rule 3, the safety net: the sender should not have sent.
      forget(r);
      if (hadGhost) show('CANCEL', 'receiver', r.edge, r.id);
      return reply(r, { type: 'TRANSFER_REJECTED', reason: 'focus' });
    }
```
**Focus:** refuse with `TRANSFER_REJECTED, reason: focus`. This is a safety net; the sender shouldn't have sent at all.

```js
    if (msg.kind !== 'tab') {
      forget(r); // files come later
      return reply(r, { type: 'TRANSFER_FAILED', error: 'unsupported' });
    }
```
Anything that isn't a tab (files come later): answer "unsupported".

```js
    if (!bridge.isConnected()) {
      // Nobody here can open a window: say so at once, so the sender gets its window back now.
      return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'no sidecar' });
    }
```
No Python helper connected, so I can't open windows: fail **immediately**. The sender's window comes back at once.

```js
    show('COMMIT', 'receiver', r.edge, r.id, {
      kind: msg.kind, title: msg.title, url: msg.url, filename: msg.filename || null, size: msg.size || null,
      fromName: nameOf(msg.fromId), mode: myMode, direct: !!msg.direct,
    });
```
Tell my glass `COMMIT`, the same message as line 27 of the fake drag in file 5, with the sender's name and my mode.

```js
    if (myMode === 'approval') {
      // Receiver rule 2: the overlay docks the card; wait for Accept or Reject.
      r.stage = 'approval';
      r.timer = setTimeout(() => endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'timeout' }), times.approval);
      return;
    }
    waitForGhost(r); // receiver rule 1: collaborative
  }
```
- **Approval:** the glass shows the Accept/Reject card. Wait up to 30 seconds. No click counts as rejected (`reason: timeout`).
- **Collaborative:** go straight on to opening the tab.

```js
  // The Approval card's answer.
  overlay.onAnswer((transferId, accepted) => {
    const r = incoming.get(transferId);
    if (!r || r.stage !== 'approval') return;
    clearTimeout(r.timer);
    if (accepted) waitForGhost(r);
    else endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'rejected' });
  });
```
**The user clicked Accept or Reject.** (This is the listener for the `answer` button from file 4.) Accept → open the tab. Reject → tell the sender "rejected".

```js
  // Where the ghost ended (DIPs). Kept for later if we are not ready for it yet.
  overlay.onGhostSettled((transferId, rect) => {
    const r = incoming.get(transferId);
    if (!r || !rect) return;
    r.rect = rect;
    if (r.stage === 'ghost') openTab(r);
  });
```
**The glass reports where the picture stopped.** (The listener for file 4's `ghostSettled` button.) Keep the spot. If we were waiting for exactly this, open the tab now.

### Notes from other laptops

```js
  // A handoff message from another laptop (room.js passes on everything it does not handle).
  function onPeerMessage(msg, payload) {
    if (!isMember(msg.fromId)) return; // only from members of our room
    const r = incoming.get(msg.transferId);
    // Focus mode: nothing may appear on our screen (E5.3), so the picture and the moves are dropped.
    const quiet = modeOf(selfId()) === 'focus';
    switch (msg.type) {
```
The room brain passes on every note it doesn't understand. Ignore strangers. `quiet` = "am I in Focus?" If so, **nothing is drawn on my screen** during someone's drag.

```js
      case 'WINDOW_PREVIEW_FRAME': {
        if (!payload || quiet) return;
        const rec = incomingFor(msg.transferId, msg.fromId, null);
        return show('PREVIEW', 'receiver', rec.edge, rec.id, { imageUrl: dataUrl(msg.mime, payload) });
      }
```
**The photo arrives:** turn it into a picture-as-text and tell my glass `PREVIEW`.

```js
      case 'EDGE_DRAG_MOVE': {
        if (quiet) return;
        const rec = incomingFor(msg.transferId, msg.fromId, msg.edge);
        if (rec.commit) return; // too late, already committed
        rec.edge = OPPOSITE[msg.edge] || rec.edge;
        const { screenWidth: W, screenHeight: H } = myProfile();
        return show('DRAG_MOVE', 'receiver', rec.edge, rec.id, {
          protrusionPx: msg.protrusionPx, centerRatio: msg.centerRatio,
          width: Math.min(msg.width, W), height: Math.min(msg.height, H), mode: modeOf(selfId()),
        });
      }
```
**"It moved":** flip the edge to mine, make sure the picture is no bigger than my screen, and tell my glass `DRAG_MOVE` with my mode.

```js
      case 'EDGE_DRAG_CANCEL':
        if (!r || r.from !== msg.fromId || r.commit) return;
        forget(r);
        return show('CANCEL', 'receiver', r.edge, r.id);
```
**"Never mind":** forget it and slide the picture away. It's ignored if it's not from the real sender, or if they already let go.

```js
      case 'TRANSFER_COMMIT':
        if (r && r.from !== msg.fromId) return;
        return onCommit(msg);
      case 'TRANSFER_ACCEPTED':
      case 'TRANSFER_REJECTED':
      case 'TRANSFER_FAILED':
        return onReply(msg);
      default:
    }
  }
```
**"It's yours"** → the commit recipe. The three **answers** → the sender's `onReply` recipe (I'm the sender in that case).

## Messages from my own Python helper

```js
  bridge.onMessage((msg, payload) => {
    switch (msg.type) {
      case 'SIDECAR_READY':
        if (msg.dpiScale > 0) sidecarDpi = msg.dpiScale;
        return;
```
"Robot phone, when the helper says something, do this." `SIDECAR_READY` = the helper has started. Keep its screen zoom number.

```js
      case 'LOCAL_DRAG_START': return onDragStart(msg);
      case 'LOCAL_WINDOW_PREVIEW': return onPreview(msg, payload);
      case 'LOCAL_DRAG_MOVE': return onDragMove(msg);
      case 'LOCAL_DRAG_END': return onDragEnd(msg);
```
The four drag messages go to the four sender recipes above.

```js
      case 'WINDOW_PLACED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') endIncoming(r, 'PLACED', { type: 'TRANSFER_ACCEPTED' });
        return;
      }
```
**"The real window is open and in place."** Tell my glass `PLACED` (fade the picture out) and answer the sender `TRANSFER_ACCEPTED`. Only now does the sender close its hidden window.

```js
      case 'OPEN_FAILED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: msg.error });
        return;
      }
      default:
    }
  });
```
**"I couldn't open it."** Tell my glass and answer `TRANSFER_FAILED`. The sender's window comes back.

## Someone left the room

```js
  // Called after every room change. Anything tied to a laptop that is no longer
  // a member (or to us, after we left the room) ends now; no timer is left behind.
  function roomChanged() {
    const t = drag && drag.transfer;
    if (t && !isMember(t.target)) {
      clearTimeout(t.moveTimer);
      drag.transfer = null;
      show('CANCEL', 'sender', t.edge, t.id);
    }
```
The room brain calls this after every change. If I'm dragging toward someone who just left, cancel.

```js
    for (const w of [...waiting.values()]) {
      if (!isMember(w.target)) finishOutgoing(w, 'FAILED'); // the window comes back at once
    }
```
If I'm waiting for an answer from someone who left, my hidden window **comes back immediately**.

```js
    for (const r of [...incoming.values()]) {
      if (isMember(r.from)) continue;
      forget(r);
      show('CANCEL', 'receiver', r.edge, r.id);
    }
  }
```
If someone who was sending to me left, forget it and slide their picture away.

```js
  return { onPeerMessage, roomChanged };
}

module.exports = { createHandoff };
```
Hand back the two buttons the room brain uses, and share the maker.

## What file 11 changed in `room.js` (file 9)

```js
const { createHandoff } = require('./handoff');
```
Borrow the new file.

```js
function createRoomManager({ relayUrl, localPort, profile: startProfile, bridge, overlay }) {
```
The room brain is now also handed the robot phone and the glass window.

```js
  const handoff = createHandoff({ transport, getState, bridge, overlay }); // the tab handoff (handoff.js)
  stateListeners.push(() => handoff.roomChanged()); // after every room change: did someone leave?
```
Make the handoff brain, and put it on the "tell me about every change" list.

```js
      default:
        return handoff.onPeerMessage(msg, payload); // not ours: maybe a handoff message
```
In "when a note arrives": notes the room brain doesn't understand used to be dropped. Now they're passed to the handoff brain.

```js
// Connect the overlay window: returns the `overlay` object the handoff uses.
// Events go to the overlay page; its answers come back here.
function wireOverlay(ipcMain, getOverlayWindow) {
  const win = () => { const w = getOverlayWindow(); return w && !w.isDestroyed() ? w : null; };
```
A recipe that plugs the glass window into the walkie-talkie. `win` = "the glass window, if it still exists".

```js
  // The Approval card needs clicks; the rest of the overlay stays click-through.
  ipcMain.on('overlay:setInteractive', (_e, on) => { const w = win(); if (w) w.setIgnoreMouseEvents(!on, { forward: true }); });
```
This is the listener for file 4's **"stop being a ghost" button**, which had nobody listening until now. When the page says `true`, the glass catches clicks (so Accept and Reject can be clicked). `false` returns it to ghost mode.

```js
  return {
    send: (event) => { const w = win(); if (w) w.webContents.send('overlay:event', event); },
    onAnswer: (cb) => ipcMain.on('overlay:answer', (_e, transferId, accepted) => cb(transferId, accepted)),
    onGhostSettled: (cb) => ipcMain.on('overlay:ghostSettled', (_e, transferId, rect) => cb(transferId, rect)),
  };
}
```
Hand back three things for the handoff brain: "tell the glass something", "tell me when Accept or Reject is clicked", and "tell me where the picture stopped". All three of file 4's unheard buttons now have listeners.

## One changed line in `index.js` (file 2)

```js
  manager = room.createRoomManager({ relayUrl: config.relayUrl, localPort: config.localPort, profile, bridge: sidecarBridge, overlay: room.wireOverlay(ipcMain, () => overlayWin) });
```
The line that makes the room brain now also hands it the robot phone (`bridge`) and the wired-up glass window (`overlay`).

---

# Small changes to UI 1's `app/control/control.js` (after the whole-project review)

UI 1 wrote this file. Only four lines were touched, so the host's address is visible and join errors read as sentences.

```js
const joinErrors = {bad_pin:'Wrong PIN. Check it and try again.', no_room:'No room with that number.', full:'The room is full.', unreachable:'Could not reach the room. Check the connection or the IP address.'};
```
A lookup form: for each short error code the room code can send back, the **sentence** to show a person.

```js
if (!result.ok) { error(joinErrors[result.reason] || result.reason || 'Could not join the room.'); return; }
```
When joining fails: show the sentence for that code. If the code isn't in the lookup, show the code itself, and if there's no code at all, show "Could not join the room."

```js
${state.localIps?.length ? `<div><span class="label">Host IP</span><strong class="ips">${esc(state.localIps.join(', '))}</strong></div>` : ''}
```
Inside the room screen's top box, after the room number and PIN: **if** the state has at least one address (`?.length` = "how many, if the list exists"), add a third block labelled "Host IP" showing the addresses separated by commas. `esc(...)` is UI 1's own cleaner that makes text safe to put on a page. If there are no addresses, add nothing.

```js
const text = `Join Odyssync\nRoom: ${state.roomNumber || 'Direct IP'}\nPIN: ${state.pin || ''}${state.localIps?.length ? `\nHost IP: ${state.localIps.join(', ')}` : ''}`;
```
The text the **Copy Invite** button copies. It used to end after the PIN. Now, if there are addresses, it adds one more line: "Host IP: …". (`\n` = "start a new line".)

In UI 1's test file `tests.js`, one expected text changed from the code `bad_pin` to the sentence "Wrong PIN. Check it and try again.", to match.

---

## The whole picture now 🧩

```
   Python helper (Tech 1)  ⇄  sidecar-bridge.js  ⇄  handoff.js  ⇄  the glass window (UI 2)
     watches the mouse,        the robot phone       the rules       shows the sliding picture
     moves real windows                                  ⇅
                                                      room.js      ⇄  the Control Center (UI 1)
                                                   the seating chart   create, join, canvas
                                                         ⇅
                                                    transport.js
                                                   the mail carrier
                                                         ⇅
                                          server.js, the front desk (Railway, and inside the host)
                                                         ⇅
                                                   the other laptops
```

**Next up:** putting the front desk on Railway, then the first real test on Windows laptops with Tech 1's helper.

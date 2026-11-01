# Voice Corrector for Autodarts

Chrome extension that fixes misdetected darts on [Autodarts](https://play.autodarts.com) by voice,
so you don't have to walk to the screen between throws.

Say *"correct second dart triple twenty"* and the dart is corrected and confirmed for you.

> **Disclaimer:** This is an independent hobby project. I have no connection to Autodarts whatsoever:
> it is not affiliated with, endorsed, sponsored or supported by Autodarts or its developers.
> "Autodarts" is used only to say which site the extension works with.

## Features

- **Correct any dart by voice**: singles, doubles, triples, bull, outer bull and misses
- **Presses OK automatically** after a correction (can be turned off)
- **Undo** the last voice correction
- **Next player**: presses the Next / Weiter button when pulling the darts out wasn't detected
- **Board control**: calibrate or reset the board by voice
- **Panel on the match page** showing what was heard and what was changed; drag it anywhere
- **No guessing**: if a command isn't clearly understood, nothing is changed
- **Configurable**: wake word, Next button label, and a word list for words speech recognition mishears
- **Robust login handling**: picks up Autodarts' renewed login; if it has expired, reloads the page
  and repeats your command

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
4. Open a match on [play.autodarts.com](https://play.autodarts.com). The panel appears in the bottom right.
5. Click **Start** in the panel (or press **Alt+V**) and allow the microphone once.

Requirements: Google Chrome on desktop, an Autodarts account and board, an internet connection
(Chrome's speech recognition runs online). Commands are in English.

## Commands

Every command starts with the wake word, `correct` by default.

| Say | Effect |
|---|---|
| `correct triple twenty` | last dart → T20 |
| `correct second dart double 16` | dart 2 → D16 |
| `correct the first dart to 5` | dart 1 → S5 (a bare number is a single) |
| `correct T20` / `correct treble 19` | short forms work too |
| `correct bullseye` / `correct outer bull` | last dart → Bull / 25 |
| `correct miss` | last dart → miss |
| `correct undo` | reverts the last voice correction (same turn only) |
| `correct next` | presses the Next / Weiter button |
| `correct board calibrate` | presses Calibrate in Board control |
| `correct board reset` | presses Reset in Board control |

The dart position can also come at the end (`correct triple twenty second`), and "dart" may be heard
as "dot". If the last wake word in a sentence is followed by a valid command, that one counts, so
`correct triple nineteen no correct triple twenty` gives T20.

## The panel

- Shows whether a match was found, how many darts the current turn has, what was heard and what was done.
- **Start / Stop** or **Alt+V** switches listening on and off.
- **Drag the title** to move the panel. The position is remembered. **Double-click the title** to put it
  back in the corner.
- Only the Autodarts tab you are looking at listens. Chrome allows one speech recognition at a time,
  so other Autodarts tabs pause automatically and show "paused".

## Settings

Click the extension's icon in the Chrome toolbar.

| Setting | Default | What it does |
|---|---|---|
| Wake word | `correct` | Word that starts every command. Pick one the caller and TV rarely say. |
| Next button label | `Next, Weiter` | Label(s) of the button `correct next` presses, comma-separated, exactly as shown in Autodarts. |
| Press OK automatically | on | Confirms a correction in Autodarts right after it's made. |
| Reload the page if the login expired | on | Only when a correction fails because of it; the command is repeated after the reload. |

**Open settings file** opens an editor for the words speech recognition tends to mishear:

```json
{
  "dartWords": ["dart", "darts", "dot", "dots", "dirt", "arrow"],
  "multiplierWords": {
    "single": ["singles"],
    "double": ["doubles"],
    "triple": ["triples", "treble", "trebles", "tripple", "tribble", "tribal", "of top of"]
  },
  "numberSoundalikes": { "won": 1, "to": 2, "too": 2, "tree": 3, "free": 3, "for": 4, "fore": 4, "ate": 8 }
}
```

Entries can be single words or phrases (`"of top of"` is heard instead of "triple"). The editor checks the
file before saving and points out mistakes. **Reset to defaults** restores the list above.

## How it works

```
src/page-hook.js   runs inside the Autodarts page (main world)
                   - picks up the login token the page itself uses
                   - reads the current turn from the page's data
                   - sends corrections the same way the Autodarts UI does
                   - reloads without the "Reload site?" prompt when needed
src/content.js     speech recognition, panel, settings, button clicks (Next, OK, Board control)
src/parser.js      speech text -> command (with tests)
src/segments.js    dartboard model: segments and board coordinates (with tests)
options.*          settings page (toolbar popup)
settings-file.*    editor for the word list
```

A correction is sent as the same request the Autodarts website sends when you correct a dart by hand.
Next, OK and Board control are pressed in the page, found by their label or icon.

## Privacy

The extension collects no data and sends nothing to the developer. Speech is processed by Chrome's
built-in speech recognition. Details: [PRIVACY.md](PRIVACY.md).

## Troubleshooting

| Problem | What to do |
|---|---|
| Nothing appears when you speak | Close other Autodarts tabs and other sites or apps that use speech input, then click **Start** in the tab you play in. The panel shows a reason if the microphone or speech service is unavailable. |
| "Microphone blocked" | Click the icon left of the address bar on play.autodarts.com and allow the microphone. |
| "Not sure which dart is last" | Say the position: `correct second dart triple twenty`. |
| "OK button not found" | Press OK by hand once and check its label; tell the developer if it isn't "OK". |
| "Next / Weiter button not found" | Enter the button's exact label in the settings. |
| A word is always misheard | Add it to the settings file (**Open settings file** in the settings). |

Debug information in the DevTools console (F12) on a match page:

```js
__autodartsVoice.summary()          // match id, login state, current turn
copy(__autodartsVoice.dump())       // copies diagnostic data (no login token) to the clipboard
```

## Development

```bash
npm test                              # parser and board-geometry tests (Node 18+)
node assets/make-icons.js --png       # regenerate logo, icons and promo tile (needs: npm i -D playwright)
```

After changing code: click the reload icon on the extension card in `chrome://extensions`, then reload
the Autodarts tab.

**Packaging for the Chrome Web Store** (PowerShell, Windows 10+):

```powershell
$v = (Get-Content manifest.json | ConvertFrom-Json).version
tar -a -cf "dist/voice-corrector-for-autodarts-$v.zip" manifest.json options.html options.js settings-file.html settings-file.js src icons
```

Raise `version` in both `manifest.json` and `package.json` before every store upload.

Store assets: `icons/icon128.png` (store icon), `assets/promo-440x280.png` (small promo tile),
`assets/store/*.png` (screenshots, 1280×800).

## Known limitations

- Commands are English only.
- Only corrections work, you cant just say a number when you did not throw a dart
- Corrections apply to the current turn; correcting a previous turn after the darts were pulled out
  is not supported.
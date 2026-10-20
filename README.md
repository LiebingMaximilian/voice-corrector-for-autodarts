# Voice Corrector for Autodarts

Chrome extension: fix misdetected darts on [Autodarts](https://play.autodarts.com)
by voice. Say *"correct triple twenty"* and the last dart becomes T20.

> **Disclaimer:** This is an independent hobby project. I have no connection to Autodarts whatsoever: it is not affiliated with, endorsed, sponsored or supported by Autodarts or its developers. "Autodarts" is used only to say which site the extension works with.

## Install (developer mode)

1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open a match on play.autodarts.com. A panel appears bottom right.
4. Click **Start** (or press **Alt+V**) and allow the microphone once.

Settings (wake word, automatic OK): click the extension's toolbar icon.

After changing code: click the reload icon on the extension card, then reload the Autodarts tab.

## Commands

| Say | Effect |
|---|---|
| `correct triple twenty` | last dart → T20 |
| `correct second double 16` | dart 2 → D16 |
| `correct the first dart to single 5` | dart 1 → S5 |
| `correct bullseye` / `correct outer bull` | last dart → Bull / 25 |
| `correct miss` | last dart → miss |
| `correct undo` | revert the last voice correction |

## Tests

```
npm test
```

Runs the parser and board-geometry tests with Node's built-in test runner (Node 18+).

## Logo

`assets/make-icons.js` generates the logo SVGs and renders `icons/icon{16,32,48,128}.png`
plus the Chrome Web Store promo tile `assets/promo-440x280.png`:

```
node assets/make-icons.js --png      # needs: npm i -D playwright
```

## Debugging

In the DevTools console on a match page:

```js
__autodartsVoice.summary()   // match id, token present?, current turn
__autodartsVoice.wsLog()     // last WebSocket messages
```

See [PLAN.md](PLAN.md) for design and open questions.

# Privacy Policy: Voice Corrector for Autodarts

_Last updated: 21 October 2026_

Voice Corrector for Autodarts ("the extension") is a free, independent hobby project for Google Chrome.
It lets you correct misdetected darts in an Autodarts match by voice.

**In short: the extension does not collect, store, sell or share any of your data. The developer
never receives anything from it.** There are no analytics, no tracking and no servers of our own.

## What the extension accesses, and why

### Your voice
When you turn listening on, the extension uses Chrome's built-in speech recognition
(the Web Speech API). Chrome sends the microphone audio to Google's speech service to turn it into
text. That processing is done by Google under
[Google's Privacy Policy](https://policies.google.com/privacy); the extension never receives the audio.

The extension only receives the recognized **text**. It checks that text for a command
(e.g. "correct second dart triple twenty") and shows it in the panel on the page.
The text is not stored and is not sent anywhere.

Listening only happens while you have it switched on (Start button or Alt+V), and only on
Autodarts pages.

### Your Autodarts login
To make a correction, the extension sends the same request the Autodarts website sends when you
correct a dart by hand. For that it uses the login token that the Autodarts page itself already
uses for its own requests. It picks the token up from the page's requests, from the page's
login renewals, or from where the Autodarts page keeps it in the browser.

- The token is only kept in memory while the page is open. The extension never saves it.
- If the login has expired, the extension can reload the Autodarts page so that it logs in again
  (setting "Reload the page if the login expired", on by default). Your last command is kept in the
  tab's session storage for up to one minute so it can be repeated after the reload; it contains
  only the dart and segment, never the token.
- It is only sent to the Autodarts API (`api.autodarts.com`), the same place the Autodarts page sends it.
- It is never sent to the developer or any third party.

### Match data
While a match page is open, the extension reads the darts of the current turn from the data the
Autodarts page receives, so it knows which dart is the "last" one and can undo a correction.
This stays in memory on that page and is discarded when you leave it.

### Your settings
Your settings (wake word, "press OK automatically", your word list, and whether listening is on)
are stored with Chrome's extension storage (`chrome.storage`). If you use Chrome Sync, Chrome syncs
these settings across your own devices through your Google account. They contain no personal data.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | To save your settings. |
| Access to `play.autodarts.com` / `play.autodarts.io` | The extension only runs on Autodarts pages, to show its panel, read the current turn and send corrections. It does not run on any other website. |
| Microphone (asked by Chrome) | For voice commands. You can revoke it at any time in Chrome's site settings for play.autodarts.com. |

## What the extension does not do

- It does not collect or transmit personal data, browsing history or usage statistics.
- It does not sell or share data with anyone.
- It does not use data for advertising, profiling, creditworthiness or any purpose unrelated to
  correcting darts.
- It does not load or run code from the internet; all code ships with the extension.

## Removing your data

Uninstalling the extension removes its stored settings from Chrome. Nothing else needs to be deleted,
because nothing else is stored.

## Changes

If this policy changes, the new version will be published here with an updated date.

## Contact

Questions or concerns: please open an issue at
<https://github.com/LiebingMaximilian/voice-corrector-for-autodarts/issues>.

---

This extension is not affiliated with, endorsed, sponsored or supported by Autodarts or its developers.

# Voice Corrector for Autodarts — plan

Correct misdetected darts on play.autodarts.com by voice, so you don't have to
walk to the screen.

## Decisions

| | |
|---|---|
| Platform | Chrome extension, Manifest V3, only on `play.autodarts.com` / `.io` |
| Language | English |
| Trigger | Wake word, default **"correct"** |
| v1 scope | Wrong segment → overwrite a thrown dart. Plus undo. |
| Speech | Web Speech API (built into Chrome, online). Offline Vosk maybe later. |

## Commands

```
correct <segment>                 replace the last dart
correct first|second|third <segment>
correct the second dart to <segment>
correct <segment> second          position may also come last
correct undo                      revert the last voice correction (same turn only)
```

Segments: `single|double|triple|treble 1–20` (bare number = single),
`T20` / `D16` glued forms, `bull` / `bullseye` / `double bull` / `50`,
`outer bull` / `single bull` / `25`, `miss`.

The parser rejects anything it isn't sure about. A wrong correction is worse
than none.

## How a correction is applied

Captured from the UI on 2026-10-20 (manual correction of dart 1 to S9):

```
POST https://api.autodarts.com/gs/v0/matches/{matchId}/corrections
Authorization: Bearer <keycloak access token, ~15 min lifetime>
Content-Type: application/json

{ "activated": 0,
  "changes": { "0": { "coords": { "x": -0.495, "y": 0.442 },
                      "segment": { "name": "S9", "number": 9, "bed": "SingleOuter", "multiplier": 1 },
                      "type": "normal" } } }
```

- `changes` is keyed by dart index within the current turn.
- `coords`: board coordinates, y up, 1.0 = outer edge of the double ring
  (fits the S9 sample, see `test/segments.test.js`). We place corrected darts
  in the middle of the bed.

## Architecture

```
page-hook.js  (MAIN world, document_start)
  - wraps fetch / XHR: remembers the latest bearer token the page itself uses
  - wraps fetch / XHR / WebSocket responses: finds match state -> current turn
  - sends the correction POST
        ▲ window.postMessage
        ▼
content.js    (isolated world)
  - webkitSpeechRecognition, continuous, auto-restart
  - parser.js  text -> command
  - segments.js  segment objects + coords
  - overlay (shadow DOM, bottom right), Alt+V toggles listening
```

The token is never stored and only sent to the API origin it came from.

## Open questions (verify next)

1. **Remaining segment formats.** Verified: singles (`SingleOuter`),
   Bull = `{ name: "Bull", number: 25, bed: "Double", multiplier: 2 }`,
   outer bull = `{ name: "25", number: 25, bed: "Single", multiplier: 1 }`.
   Still guessed: triple (`Triple`), double ring (`Double`, likely given the bull),
   miss (`Miss`/0/`Outside`/×0).
   → Correct a dart by hand to a triple and to a miss, copy the bodies.
2. ~~What `activated` means~~ — verified: the index of the dart being changed,
   same as the key in `changes`.
3. **Match state format.** Assumed `{ id, players, turns: [{ id, throws: [{ segment, coords }] }] }`.
   Needed for "last dart" and undo; without it you must say first/second/third.
   → During a match, run `__autodartsVoice.summary()` in the DevTools console.
   If `turn` is null, run `__autodartsVoice.wsLog()` and look at the messages.
4. Does a correction of the *previous* turn work (after takeout)? Probably needs
   a different request. Out of scope for v1.

## Milestones

- [x] Capture the correction request
- [x] Skeleton: manifest, hook, parser + tests, overlay
- [ ] Verify open questions 1–3 against a real match
- [ ] Play a few legs with it; tune parser with real transcripts
- [ ] Settings popup: wake word, language, microphone
- [ ] Later: add / remove darts, next player, offline recognition

# Changelog

## 3.5.5

- Fix (X01): Autodarts did not start again after a lost DartCounter leg.
  - Checked on the real app.dartcounter.net (local X01 match vs DartBot, wide and narrow window) in WebKit and Chromium with a Tampermonkey-like sandbox: the lost leg is seen and the order reaches the game tab within a second.
  - The step that never ran for real was on the Autodarts side: `games/restart` is in the Autodarts app's API client, but no button of the app uses it, and no public list of the app's API calls has it.
  - A leg in progress is now taken back to its start with the app's own Undo (`POST /undo`, one dart or one change of turn per call; Autodarts never undoes past the start of a leg). Each step waits for the new match state. Fallbacks: `games/restart`, then a new match like the app's "Play again".
  - Turns shown again while rewinding are never sent. A dart thrown during the rewind is undone as well and listed under "Niewpisane tury" in DartCounter.
- Orders between the tabs: the game tab answers at once ("received", with its version), then with every Autodarts API step and its HTTP code, then the result. Without an answer DartCounter sends the same order again after 3 s and 6 s (it runs once), then says clearly what is wrong (game tab closed, asleep, other version, or not reading orders).
- New: both tabs send a heartbeat with their version. Each panel warns when the other tab is closed or asleep, or runs another version, and says which tab to refresh.
- DartCounter leg end also from DartCounter's own saved local match (IndexedDB): finished legs and who won the last one. A leg won by the DartBot is a lost leg. The rests and the legs counter stay as signals.
- Around the Clock: when Autodarts ends its game on a dart that is not the bullseye (e.g. 25 on the bull) while DartCounter finishes only on 50, the game tab itself starts the next Autodarts game (`games/next`, like the won X01 leg; else "Play again"). DartCounter counts 25 as Miss, 50 ends the game, nothing to click. Only while DartCounter plays Around the Clock with the bridge on, and only for orders that end on the bull. The throw correction (`PATCH throws`) is still tried first (up to 4 s). The ATC target is also read under other state field names.
- Tests: new checks for all of the above (logic and jsdom), and browser tests (`npm run test:browser`) in WebKit and Chromium with a Tampermonkey-like sandbox: X01 lost leg, Around the Clock 25, version warning.
- X01 entry, the won leg and the rest of Around the Clock unchanged.

## 3.5.4

- Fix (X01): the Autodarts reset after a DartCounter leg now works in Tampermonkey. Real cause, present since 3.5.1:
  - The game tab ignored every answer from its page helper. It checked `ev.source === window`, but in a userscript sandbox `window` is a proxy, so the check never matched.
  - The requests reached Autodarts, but the script never saw the answers, and the reset ran into timeouts.
  - Messages are now matched by page origin and request id.
  - Checked in WebKit and Chromium with a sandbox-like `window`.
- New (X01): a won leg in Autodarts (checkout to 0) goes on to the next leg by itself, 2.5 s after the checkout visit went out. When the Autodarts match is over, a new match starts. Off with "Reset Autodarts: wyłączony". The result is shown in the DartCounter panel.
- Around the Clock and the rest of X01 unchanged.

## 3.5.3

- Around the Clock only: Autodarts now counts the outer bull (25) as a miss on the bull target and finishes only on the bullseye (50), like DartCounter with "Finish by hitting the bullseye".
  - Autodarts has no setting for this. Mode Full takes 25 and 50 on the bull target, and only Double/Triple require 50 but then for every number too.
  - So the game tab corrects the 25 to a miss with the app's own throw correction (`PATCH /matches/{id}/throws`, the dart moved outside the board). The game goes on.
  - No correction when DartCounter also counts 25 ("bull or bullseye").
  - If Autodarts refuses the correction, the 3.5.2 fallback stays: DartCounter takes 25 as a miss and the game tab starts the Autodarts game again.
- X01 unchanged.

## 3.5.2

- Fix: after a lost DartCounter leg, Autodarts was not reset. The leg end was only seen when two consecutive readings of the rests went straight to the start score. It was missed when DartCounter redrew the scoreboard between legs (the rests gone for a moment) and when the players start from different scores (handicap).
  - Rests are now compared with the last complete reading.
  - DartCounter's legs counter (+ 1 for a player, or a won set) is a second signal. An undo never counts as a leg end.
- Reset on the Autodarts game tab is more robust. When no new match can be made from the running one, the script leaves the match ("Leave", like the app's button) and starts a new one from it ("Play again").
- Around the Clock only: when Autodarts ends its game (e.g. on the outer bull 25), the game tab starts the Autodarts game again, so the next darts keep coming to DartCounter.
  - This applies when DartCounter still plays: "Finish by hitting the bullseye" counts 25 as a miss.
  - It uses the next game (like the app's Next button) or a new match with the same settings.
  - Nothing happens when both sides finished on 50, or with "Reset Autodarts: wyłączony".
  - X01 is unchanged by this.
- Diagnostic log lines (Kopiuj log):
  - DartCounter tab: leg / match end detected (which signal), won or lost and why, the setting, the order to the game tab and its answer.
  - Game tab: the order received, the match state, the plan, and every Autodarts API step with its answer.

## 3.5.1

- Fix: the script now answers DartCounter's darts dialog itself ("Darts used on a double" / "Darts used for checkout"). DartCounter opens it after a checkout, after a bust, and after a visit that leaves 50 or less.
  - Checkout darts: which dart of the visit finished (1-3).
  - Darts at a double: darts thrown while the rest was 50 or an even 2-40 (DartCounter's rule).
  - Works with per-dart and sum entry. A dialog the script did not cause waits for the player, with a clear panel message.
- Fix: a visit is never lost silently any more. Before, the unanswered dialog stopped the queue and the next visits were dropped after 120 s ("script stopped working").
  - Time while DartCounter asks does not count toward the limit.
  - An entry that left no trace in DartCounter is tried again (up to 3 times).
  - A visit that cannot be entered is listed in the panel ("Niewpisane tury", red dot) and in the console until "Wyczyść niewpisane".
- New: Reset Autodarts. When a DartCounter leg or match ends, the Autodarts game tab starts fresh at the X01 start score.
  - Panel setting: every leg end (default), only a lost leg, match end, or off.
  - What it does: a finished leg goes to the next leg, a leg in progress restarts. Otherwise it starts a new match with the same settings and moves the tab to it. It uses the Autodarts app's own API with the app's own login.
  - A turn in progress goes to DartCounter first. Visits after a reset get new ids, so they are not taken for duplicates.
  - The result is shown in the panel; a failure shows a clear message.
- The page scripts on the Autodarts game tab are injected even when the userscript starts before `<html>` exists.

## 3.5.0

- Around the Clock: an Autodarts ATC game (or the local board) is entered into DartCounter's Around the Clock dart by dart: a hit on the current target (S, D or T key) or Miss, then the turn is submitted.
  - Supported: 1 to 20, then bull. DartCounter: "Play from 1 to 20", segments All/Single/Double/Treble, 1-3 hits, "Increase by segment" off, any bull setting ("Finish by hitting the bullseye" = only 50). Autodarts: order 1-20-Bull with a matching mode (Full/Single/Double/Triple) and hits.
  - DartCounter's settings decide what is a hit. Autodarts also finishes on the outer bull (25); with "Finish by hitting the bullseye" DartCounter only finishes on 50 (intended).
  - Other orders and settings, the clickable-board keyboard and a different game on each side are skipped with a clear message in the panel and in the console.
- X01: a visit is only entered into an X01 match when Autodarts plays X01 (or the source is the local board), never an ATC visit.

## 3.4.1

- Fireworks only for the bullseye (50, D-Bull). The outer bull (25) no longer shows fireworks or plays the fireworks sound.
- Safari: fireworks animate the same as in Chrome.
  - `requestAnimationFrame` is called on `window` (WebKit rejects an unbound call from a userscript sandbox, which left an empty overlay on the screen).
  - Motion is time based, so speed and length are the same at 60 Hz and 120 Hz.
  - The overlay is removed by a timer even when the tab gets no animation frames (hidden tab).
  - The overlay is sized with `inset: 0` (no scrollbar width), no blend modes or vendor prefixes needed.
- Safari audio: a suspended or interrupted audio context is resumed quietly when a sound plays or the tab becomes visible again; no console errors while audio is still locked.

## 3.4.0

- Fireworks on a bull (canvas overlay with `pointer-events: none`, gone in about 2.6 s) and a short fireworks sound (CC0).
- The round speaker button switches sounds and fireworks together; "Test fajerwerków" in the panel.

## 3.3.0

- Dart sounds: S1/D1/T1 laugh, T20 cheer, miss boo, S1 + S5 + S20 combo (combo has priority over the S1 laugh); one sound at a time.
- Round speaker button next to the panel pill (state saved), volume slider, "Test dźwięku".
- Sound files in `sounds/` (CC0), loaded once from the raw URL on `main`.

## 3.2.1

- The DartCounter keyboard decides how a visit is entered: per-dart keyboard means dart by dart, text field or number pad means the sum. An unsupported keyboard gets a clear error and the visit waits.
- Readable `console.warn` with details when an entry fails.
- The script file is plain ASCII (Polish text as `\u` escapes).

## 3.2.0

- First public version: visits from the Autodarts game tab (after corrections) or the local `/api/state`, entered once per visit into DartCounter, as a sum or dart by dart; small debug panel.

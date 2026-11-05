# Changelog

## 3.6.1

- Fix: after the last leg of a local match (e.g. a match lost against the DartBot) Autodarts was not reset. After "Rematch" it still showed the old game, not finished.
  - Real cause, from DartCounter's app code: a local game (X01, Cricket, Around the Clock) ends by removing its saved match, opening the end screen and going back to the game's setup page (`/local-games/<game>`) at once. The end screen is on the setup page, not on the game page, and the last leg shows no new leg on the scoreboard. The script looked for the end screen only on the game page, so the end of a local match was never seen.
  - Now the end screen on the setup page, right after the game page, is the end of the match: reset order for that game (X01, Cricket, Around the Clock), won or lost, with the same answer and retry as after a leg, and the board Reset.
- Fix: DartCounter uses the same dialog for "Statistics" in the in-game menu (without "Rematch"). Up to 3.6.0, opening it in the middle of a local match counted as the end of the match and reset Autodarts. It never does now.
- New: a new DartCounter game resets Autodarts like a lost leg: "Rematch", a game started from the setup page, or the DartCounter page opened at the start of a match.
  - The new game is seen at the very start of the match for 1.5 s: X01 every rest at the start score and no leg won, Cricket every number 0, Around the Clock target 1.
  - The game tab brings Autodarts to the start of a leg (Undo; `games/next` or a new match when the Autodarts game is over).
  - Nothing happens when Autodarts is there already, when a turn of the new game is being thrown or already went to DartCounter, or with "Reset Autodarts: wyłączony" (every other setting resets for a new game).
  - A match resumed in the middle is not a new game.
- Around the Clock: the end of the DartCounter game now resets Autodarts too. Lost: the Autodarts game goes back to its start with Undo. Won, Autodarts finished on 50 too: next Autodarts game (`games/next`). Board Reset after the game.
- Fix (Around the Clock): the game tab took the start of every Autodarts turn for the start of the game (no darts in the current turn). Now the start of the game is round 1 with no darts, and every target index at 0 when the state has them.
- New: the whole camera picture in local games (button "Kamera: pełny kadr" in the panel, on by default). Same field of view as in Autodarts.
  - Real cause, from DartCounter's app code: DartCounter asks the browser for the camera with `aspectRatio: { exact: 1 }`. The browser then cuts a square out of the middle of the camera picture before DartCounter gets it. "Zoom" is the camera's own zoom, so at its minimum it is still that square. DartCounter also shows the camera of a local game in a square box with `object-fit: cover`.
  - On the pages of local games (`/local-games/...`, `/game/...`) a page script drops only that 1:1 request, so the camera sends its whole picture (e.g. 1280×720). Height (720), frame rate, chosen camera and zoom stay as DartCounter asks.
  - The local game's camera box takes the camera's aspect ratio (as large as its place allows) with `object-fit: contain`. "Zoom" works as before.
  - Online games, their cameras and every other page keep DartCounter's request and view.
  - Takes effect when the camera is turned on ("Włącz kamerę") after the button is switched. Off: DartCounter's square again.
- Tests: logic for the new game and the start of a match; DartCounter pages in jsdom with the real end of a local match (end screen on the setup page) for X01, Cricket and Around the Clock, won and lost, "Statistics" in the middle of a match, "Rematch", a match resumed in the middle; the game tab with new-game orders and the Around the Clock end; the camera button (local camera box, online camera untouched, button off).
- X01, Around the Clock and Cricket entry unchanged.

## 3.6.0

- New: Cricket. An Autodarts Cricket game is entered into DartCounter's "Cricket / Tactics" (local match) dart by dart, like X01 and Around the Clock.
  - Keys 15-20 and bull as single, double or treble (`20`, `D20`, `T20` ... `SBULL` = 25, `BULL` = 50), then "Submit". Each dart is checked in DartCounter's score input before the turn is submitted.
  - DartCounter counts marks, closed fields and points. Darts outside the game (1-14, misses) and darts on a field everybody has closed (DartCounter disables that key) are left out, so DartCounter counts them as misses. A turn without a dart in the game is submitted empty.
  - Corrections made in the Autodarts game before the end of the turn are in the result, like in X01.
  - Settings: Autodarts game mode Cricket / Tactics must match DartCounter's mode Cricket / Tactics. The scoring (Standard / Cut Throat / No Score) must match when Autodarts plays 2+ players; Autodarts alone only gives the darts and DartCounter counts the points (DartCounter itself uses its scoring only with 2+ players). Hidden Cricket does not exist in DartCounter. Any mismatch: the visit is not entered, with the reason in the panel ("Niewpisane tury") and in the console.
  - Start and end: a won Autodarts Cricket leg goes on to the next leg by itself (like X01). A DartCounter Cricket leg end (the legs counter goes up) sends the reset order for Cricket: the game tab takes the Autodarts leg back to its start with the app's Undo (`games/restart`, then a new match as fallbacks), with the same answer and retry as X01. Won or lost = whose legs counter went up, compared with the player the visits are entered for.
  - Board Reset after every Cricket leg, like X01 (button "Reset tarczy po legu").
  - Panel: "Strona meczu: TAK (Cricket / Tactics)" and a row with DartCounter's Cricket settings.
- New: manual board Reset, for a board that stays in takeout after the darts are pulled (orange in Autodarts instead of green, no darts counted). Button "Reset tarczy" on top of the DartCounter overlay (next to the pill and the speaker, also with the panel closed) and the shortcut Alt+Shift+R.
  - The shortcut does nothing while typing in a field (also DartCounter's own fields, whose input sits inside the field's shadow DOM). DartCounter's own keys (digits, Enter, Backspace, Ctrl+Z, Ctrl+Enter, arrows, F11) have no Alt+Shift.
  - The same Reset as "Reset" in Autodarts Desktop (key R in the Autodarts game): local Board Manager first (`POST 127.0.0.1:3180/api/reset`, the "Adres API" address), the cloud board service (game tab) as fallback. Never a calibration.
  - Runs at once, without waiting for the takeout, also when the board state cannot be read and also with "Reset tarczy po legu" off.
  - Then on to the next throw: when Autodarts still waits on the same full turn (3 darts, or a bust) 3 s after the Reset, the game tab uses the app's own "Next" (`POST /matches/{id}/players/next`, Space / Enter in the Autodarts game), so that turn goes to DartCounter. A turn in progress (1-2 darts) goes on; nothing is done when Autodarts moved on by itself, when the leg is over or while a leg reset runs.
  - Result: the button shows "Reset tarczy..." while it runs, then a check mark (green) or a cross (red), with a note under it: green "tarcza gotowa" (and the Next step), or red with the reason. A failure is also a red error in the panel. Board state before and after in the log and in the panel row "Reset tarczy". A second click while it runs does nothing.
  - No automatic reset after N seconds in takeout: left out on purpose. Autodarts gives no reliable signal that the darts are out of the board: a board stuck in takeout and a player still pulling the darts look the same (status "Takeout", the darts of the turn still listed), so a timer could reset the board or move on while darts are still in it and skip a round. The reset stays a decision of the player (button or shortcut).
- Reset orders name their game (X01, Around the Clock, Cricket). The game tab refuses an order when Autodarts plays another game, with a clear message in the DartCounter panel.
- Tests: Cricket logic, a DartCounter Cricket page in jsdom (built from the real page's markup), the game tab with Cricket orders and the manual board Reset (full turn stuck -> Next, Autodarts moving on by itself, turn in progress, Next refused), the button, its notes and the shortcut guard, and a browser scenario (WebKit and Chromium): Cricket visits, lost leg, Undo in Autodarts, board Reset, then a full turn stuck in takeout freed by the button.
- Checked on the real app.dartcounter.net (guest account, local Cricket with Standard scoring vs DartBot and alone) in WebKit and Chromium, with a simulated Autodarts game tab and Board Manager: entry dart by dart, misses, closed fields, lost and won leg, Undo / next leg in Autodarts, board Reset, and a full turn stuck in takeout freed by the button (Reset, then Next, then the turn in DartCounter). X01 lost leg and Around the Clock 25 on the bull checked again the same way. Not checked with a real board, a real Board Manager or a real Autodarts account.
- X01 and Around the Clock entry unchanged.

## 3.5.6

- Fix (Around the Clock): the outer bull (25) on the bull target now becomes a miss in Autodarts, so Autodarts plays on to the bull like DartCounter ("Finish by hitting the bullseye").
  - Real cause: since 3.5.3 the throw correction was sent with type `Normal`. The Autodarts app only knows lower-case types such as `normal` and `bouncer`, so the correction never applied.
  - Step 1: the correction in the app's own format, the 25 as a bouncer (`PATCH throws` with `{ type: "bouncer" }`, like the app's "Bouncer" button: Miss, 0 points).
  - Step 2: if Autodarts refuses it or still ends the game: the app's Undo on the 25. DartCounter gets a Miss in its place, Autodarts plays on.
  - Step 3: neither works: the 3.5.5 fallback (DartCounter takes 25 as Miss, the game tab starts the next Autodarts game).
  - The log says which step worked ("krok 1/2/3 z 3"), in both tabs. Only while DartCounter plays Around the Clock with the bridge on.
- New (X01): board Reset after every leg, won or lost (button "Reset tarczy po legu", on by default), the same Reset as in Autodarts Desktop or key R in the game.
  - After a leg the board can stay in takeout (yellow outline in Autodarts Desktop) and stop counting.
  - After the Autodarts reset of the leg, the script waits up to 6 s for the darts to come out. Then it resets the board when it is ready or still in takeout, never while darts of a turn are on it.
  - Local Board Manager first (`POST http://127.0.0.1:3180/api/reset`, the "Adres API" address), the cloud board service as fallback (game tab, the app's login). Never a calibration.
  - Board state before and after the Reset in the log; result in the panel row "Reset tarczy".
- Fix: the first result from the game tab after opening DartCounter (next leg, Around the Clock restart) is now shown in the log as well.
- X01 entry unchanged.

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

# Changelog

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

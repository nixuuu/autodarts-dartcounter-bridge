// ==UserScript==
// @name         AutoDarts -> DartCounter Bridge (debug edition)
// @namespace    https://github.com/nixuuu
// @author       nixuuu
// @version      3.5.4
// @description  Reads AutoDarts visits (X01 game on play.autodarts, after corrections; or the local Board API /api/state) and enters each visit once into app.dartcounter.net. Small debug panel with copyable log.
// @match        https://app.dartcounter.net/*
// @match        http://127.0.0.1/*
// @match        http://127.0.0.1:*/*
// @match        http://localhost/*
// @match        http://localhost:*/*
// @match        https://play.autodarts.io/*
// @match        https://play.autodarts.com/*
// @run-at       document-start
// @sandbox      JavaScript
// @noframes
// @homepageURL  https://github.com/nixuuu/autodarts-dartcounter-bridge
// @updateURL    https://raw.githubusercontent.com/nixuuu/autodarts-dartcounter-bridge/main/autodarts-dartcounter-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/nixuuu/autodarts-dartcounter-bridge/main/autodarts-dartcounter-bridge.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_info
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      raw.githubusercontent.com
// @connect      *
// ==/UserScript==

/*
 * AD2DC 3.5.4
 *
 * 3.5.4 (X01): the Autodarts reset never worked in Tampermonkey: the game tab dropped every answer of its page helper
 *   (it checked ev.source === window, but a userscript's `window` is a sandbox proxy). Requests reached Autodarts, the
 *   answers did not reach the script, so the reset timed out. Messages are now matched by page origin + request id.
 *   New: a won X01 leg in Autodarts (checkout to 0) goes on to the next leg by itself, 2.5 s after the checkout visit
 *   went out (Autodarts match over -> new match). Off with "Reset Autodarts: wy\u0142\u0105czony".
 *
 * 3.5.3 (Around the Clock only): Autodarts has no "bullseye only" setting (mode Full takes 25 and 50 on the bull target).
 *   The game tab corrects an outer bull (25) thrown at the bull target to a miss with the app's own throw correction,
 *   so Autodarts finishes only on 50, like DartCounter "Finish by hitting the bullseye". Not when DartCounter counts 25
 *   too. If Autodarts refuses the correction, the 3.5.2 fallback stays: DartCounter takes 25 as a miss and the game tab
 *   starts the Autodarts game again. X01 unchanged.
 *
 * 3.5.2: the end of a DartCounter leg is also seen when the scoreboard is gone for a moment between legs or the
 *   players start from different scores (handicap): rests are compared with the last complete reading, and the legs
 *   counter (+ 1) is a second signal. Reset on the game tab: when no lobby can be made from the running match, it is
 *   left (surrender, like the app's "Leave") and a new one starts from it ("Play again"). Diagnostic log lines for the
 *   leg end (why, won / lost, setting) and for every reset step and API answer.
 *   Around the Clock only: when Autodarts ends its game (e.g. on 25) and DartCounter (bullseye) plays on, the game tab
 *   starts the Autodarts game again (next game / new match) so the darts keep coming. X01 is not affected by this.
 *
 * 3.5.1: DartCounter's dialog "Darts used on a double" / "Darts used for checkout" (it opens after a checkout,
 *   a bust or a visit that leaves <= 50) is answered from the darts of the visit (checkout dart = 1-3, darts at a
 *   double = darts thrown while the rest was 50 or an even 2-40). Before, the open dialog stopped the queue and the
 *   next visits were dropped after 120 s. Now: time while DartCounter asks does not count, failed entries with no trace
 *   in DartCounter are tried again (3 times), and a visit that cannot be entered stays on the panel ("Niewpisane tury").
 *   Reset Autodarts: when a DartCounter leg / match ends (setting: every leg end (default), only a lost leg, match end,
 *   off) the Autodarts game tab starts fresh at the X01 start score: leg over -> next leg, leg in progress -> leg
 *   restart, else a new match with the same settings (the app's own API with the app's own login, nothing stored).
 *   A turn in progress goes to DartCounter first; visits after a reset get new ids (never dropped as duplicates).
 *
 * Around the Clock (3.5.0): an Autodarts ATC game (or the local board) goes to DartCounter's Around the Clock
 *   (/game/around-the-clock) dart by dart on its hit keyboard (S/D/T of the current target, bull, Miss).
 *   DartCounter's own settings decide what is a hit (e.g. "Finish by hitting the bullseye" = only 50 at the end).
 *   Supported: DartCounter order 1 -> 20 then bull, segments all/single/double/treble, 1-3 hits, one target per hit
 *   ("Increase by segment" off); Autodarts order "1-20-Bull" with mode Full/Single/Double/Triple and matching hits.
 *   Anything else is skipped with a clear log. ATC visits never go into an X01 match and the other way round.
 *
 * Bull fireworks (3.4.0, 3.4.1): a canvas overlay (pointer-events: none, upper part of the screen, gone in ~2.6 s)
 *   for the bullseye (50) only, plus a short fireworks sound (CC0, see README). The round speaker button switches
 *   sounds and fireworks together. 3.4.1 (Safari): requestAnimationFrame is called on window (WebKit throws on an
 *   unbound call from a userscript sandbox), motion is time based (same speed at 60 and 120 Hz), the overlay is
 *   removed by a timer even when the tab is hidden, and a suspended / interrupted audio context is resumed.
 *
 * Dart sounds (3.3.0): S1/D1/T1 -> laugh, T20 -> cheer, miss (outside the board) -> boo,
 *   a turn of exactly S1 + S5 + S20 (any order) -> combo sound at the end of the turn instead of the S1 laugh.
 *   One sound at a time: a new sound stops the one that is playing (no queue, so sounds never lag behind the darts).
 *   Files in sounds/ (CC0 / public domain, see README), loaded once from raw.githubusercontent.com (main) with
 *   GM_xmlhttpRequest and played with WebAudio. The audio context is created on the first real click / key press
 *   (autoplay rules). Sounds run beside the bridge and never delay or change the score entry.
 *
 * Source "gra" (default): an X01 game open on play.autodarts.com / .io. The script listens to the page's own
 *   WebSocket (channel autodarts.matches, match state, turns[0] = turn in progress). Corrections made in the
 *   game change that state. A visit is published when the turn ends (next turn / leg finished) and handed
 *   to the DartCounter tab through userscript storage (value-change listener + polling).
 * Source "lokalnie" (fallback, switch in the panel): the DartCounter tab polls http://127.0.0.1:3180/api/state
 *   with GM_xmlhttpRequest. Fallback B: an open AutoDarts tab (127.0.0.1) relays its own /api/state.
 *
 * /api/state formats handled (sources: ioBroker.autodarts cloud.js, ha-autodarts, DartLab protocol notes):
 *   old:  { status:"Throw", event:"Throw detected", numThrows, throws:[{ segment:{name,number,bed,multiplier}, coords }] }
 *   new:  { status:"throw"|"takeoutInProgress", event:"throwDetected"|..., throws:[{ segmentName, segmentNumber, multiplier, bed, coordsX, coordsY }] }
 *   The "throws" field is missing while the board is empty.
 *
 * DartCounter entry (checked statically in the app.dartcounter.net bundle, 2026-10-30):
 *   component <app-keyboard-score-input>;
 *   keyboard "none"   -> <input inputmode="numeric" maxlength="3">; (input) event + keydown key "Enter" submits;
 *   keyboard "numbers"-> keydown listener on document: digits, "Backspace", "Enter".
 *   The component is removed while a CPU player (DartBot) throws.
 *   keyboard "single" (3.2.0, option "Wpis: lotka po lotce"): <app-single-dart-keyboard> buttons
 *   "Single"/"Double"/"Treble" (fixed English text), numbers 1-20 ([dcTypography=bulevar-32]), "Outer 25", "Bull 50",
 *   Miss (class "!uppercase"), Confirm on bust ([dcButton]); DartCounter checks bust/double-out per dart itself.
 *   Entered darts show in app-keyboard-score-input ([dcTypography=bulevar-40]); "button.submit-button" ends the turn.
 *   3.2.1: the DartCounter keyboard decides how a visit is entered: per-dart keyboard -> dart by dart (also when the
 *   panel says "suma tury"), text field / number pad (app-numbers-keyboard) -> sum. A sum is never typed into a
 *   keyboard that cannot take it ("dartboard", "hotkeys"): clear error instead. The file is plain ASCII
 *   (Polish text as \u escapes), so a wrong charset on install cannot break the log text.
 *
 * Dart correction (3.1.0): the panel shows the darts of the current visit; each one can be changed
 * before the visit is sent (sending happens only after the takeout, optionally after a delay).
 * A correction made in an Autodarts match on play.autodarts goes to the match state in the cloud
 * (game service), not to the local /api/state, so it is not used here.
 */

(function () {
  "use strict";

  const VERSION = "3.5.4";
  const PREFIX = "[AD2DC]";

  // =====================================================================
  // Core: pure logic (no DOM). Also exported for Node tests.
  // =====================================================================
  const Core = (() => {
    function toNum(v) {
      if (typeof v === "string" && v.trim() !== "") v = Number(v);
      return typeof v === "number" && isFinite(v) ? v : null;
    }

    // Parses dart labels like "T20", "D16", "S5", "25", "Bull", "M12", "Miss".
    function parseLabel(lbl) {
      const s = String(lbl == null ? "" : lbl).trim().toUpperCase().replace(/\s+/g, " ");
      if (!s) return null;
      if (/^(M\d*|MISS|OUT|OUTSIDE|-)$/.test(s)) return { number: toNum(s.slice(1)) || null, multiplier: 0 };
      if (["BULL", "DBULL", "D-BULL", "DB", "D25", "50", "BULLSEYE", "INNER BULL"].includes(s)) return { number: 25, multiplier: 2 };
      if (["25", "SB", "S25", "SBULL", "OUTER BULL", "OUTERBULL"].includes(s)) return { number: 25, multiplier: 1 };
      let m = s.match(/^([SDT])(\d{1,2})$/);
      if (m) {
        const n = parseInt(m[2], 10), mult = { S: 1, D: 2, T: 3 }[m[1]];
        if ((n >= 1 && n <= 20) || (n === 25 && mult < 3)) return { number: n, multiplier: mult };
        return null;
      }
      m = s.match(/^(\d{1,2})$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 20) return { number: n, multiplier: 1 };
      }
      return null;
    }

    function makeLabel(number, mult) {
      if (mult === 0) return "M" + (number ? number : "");
      if (number === 25) return mult === 2 ? "BULL" : "25";
      return ["", "S", "D", "T"][mult] + number;
    }

    // One throw from /api/state (old nested or new flat format) -> { label, score, multiplier, number, ok }.
    function normalizeThrow(t) {
      if (t == null) return null;
      if (typeof t === "string") t = { segmentName: t };
      if (typeof t !== "object") return null;
      const seg = t.segment && typeof t.segment === "object" ? t.segment : {};
      const name = [seg.name, t.segmentName, t.name, typeof t.segment === "string" ? t.segment : undefined]
        .find(v => typeof v === "string" && v.trim() !== "");
      let number = toNum(seg.number != null ? seg.number : t.segmentNumber != null ? t.segmentNumber : t.number);
      let mult = toNum(seg.multiplier != null ? seg.multiplier : t.multiplier != null ? t.multiplier : t.segmentMultiplier);
      const bed = String(seg.bed != null ? seg.bed : t.bed != null ? t.bed : t.segmentBed != null ? t.segmentBed : "");
      const parsed = parseLabel(name);
      if (mult === null && parsed) mult = parsed.multiplier;
      if (number === null && parsed) number = parsed.number;
      if (/outside|miss/i.test(bed) || number === 0) mult = 0;
      if (number === 50) { number = 25; mult = 2; }
      if (mult === null || (mult > 0 && number === null)) {
        return { label: name ? String(name) : "?", score: 0, multiplier: null, number, ok: false };
      }
      const valid = mult === 0 || (mult >= 1 && mult <= 3 && ((number >= 1 && number <= 20) || (number === 25 && mult <= 2)));
      return {
        label: makeLabel(number, mult),
        score: mult === 0 ? 0 : number * mult,
        multiplier: mult,
        number,
        ok: valid
      };
    }

    function keyOf(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z]/g, ""); }

    // Whole /api/state -> normalized snapshot.
    function normalizeState(raw) {
      if (!raw || typeof raw !== "object") return null;
      const list = Array.isArray(raw.throws) ? raw.throws : Array.isArray(raw.darts) ? raw.darts : null;
      const darts = list ? list.map(normalizeThrow).filter(Boolean) : [];
      const numThrows = toNum(raw.numThrows);
      return {
        darts,
        count: darts.length,
        hasThrowsField: !!list,
        throwsMissing: !list && numThrows !== null && numThrows > 0,
        numThrows,
        status: raw.status == null ? "" : String(raw.status),
        event: raw.event == null ? "" : String(raw.event),
        statusKey: keyOf(raw.status),
        eventKey: keyOf(raw.event),
        unknown: darts.filter(d => !d.ok).length
      };
    }

    // "Takeout started" / "takeoutInProgress" = player is pulling darts. "Takeout" alone (3rd dart) is not.
    function isPulling(st) {
      const k = [st.statusKey, st.eventKey];
      return k.includes("takeoutstarted") || k.includes("takeoutinprogress");
    }

    function sameStart(a, b) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (a[i].label !== b[i].label) return false;
      return true;
    }

    // Visit tracker. Feed it every snapshot (also repeated ones).
    // A visit is sent exactly once, and only AFTER the takeout ends:
    //   - the board is empty again (throws missing/empty), or
    //   - the darts were being pulled and the state is back to "throw".
    // Darts left on the board send nothing, however long the state stays the same.
    // Corrections: ov = { slot(0..2): dart }. A correction wins over the detected dart in that slot.
    function applyOverrides(darts, ov) {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const d = ov && Object.prototype.hasOwnProperty.call(ov, i) ? ov[i] : darts[i];
        if (d) out.push(d);
      }
      return out;
    }

    function createTracker(onVisit, log) {
      log = log || function () {};
      let visit = null; // { id, darts, firstTs, sawThrow, pulled, done, ov }
      let started = false, seq = 0;
      const sig = d => d.map(x => x.label).join(" ");
      const fresh = (st, now, throwing) => ({ id: now + "#" + (++seq), darts: st.darts.slice(), firstTs: now, sawThrow: throwing, pulled: false, done: false, ov: {} });

      function finish(reason) {
        if (!visit || visit.done || !visit.sawThrow || !visit.darts.length) return;
        visit.done = true;
        const darts = applyOverrides(visit.darts, visit.ov);
        if (!darts.length) return;
        onVisit({ id: visit.id + " " + sig(visit.darts), darts, extraDarts: Math.max(0, visit.darts.length - 3), reason, firstTs: visit.firstTs,
          detected: visit.darts.slice(0, 3), ov: Object.assign({}, visit.ov), corrected: Object.keys(visit.ov).length > 0 });
      }

      return {
        reset() { visit = null; started = false; },
        current() { return visit; },
        // darts of the open (not yet sent) visit, corrections applied; null when there is none
        openDarts() { return visit && !visit.done ? applyOverrides(visit.darts, visit.ov) : null; },
        openSlots() {
          if (!visit || visit.done) return null;
          return [0, 1, 2].map(i => Object.prototype.hasOwnProperty.call(visit.ov, i)
            ? { dart: visit.ov[i], edited: true } : { dart: visit.darts[i] || null, edited: false });
        },
        // dart = normalized dart, or null for "remove", or undefined for "back to AutoDarts"
        setOverride(slot, dart) {
          if (!visit || visit.done || slot < 0 || slot > 2) return false;
          if (dart === undefined) delete visit.ov[slot]; else visit.ov[slot] = dart;
          return true;
        },
        update(st, now) {
          if (!st || st.throwsMissing) return;
          now = now || Date.now();
          const pullingRaw = isPulling(st);
          // a fresh "throwDetected" event wins over a takeout status that may still linger
          const pulling = pullingRaw && st.eventKey !== "throwdetected";
          const throwing = !pulling;

          if (!started) {
            started = true;
            if (st.count > 0) {
              visit = fresh(st, now, !pulling);
              if (pulling) {
                visit.done = true; // connected in the middle of a takeout: darts may be missing already
                log("Start w trakcie wyjmowania lotek (" + sig(st.darts) + "). Tej tury nie wysy\u0142am, wpisz j\u0105 r\u0119cznie.");
              } else {
                log("Start: na tarczy s\u0105 ju\u017c lotki tej tury: " + sig(st.darts));
              }
            }
            return;
          }

          if (st.count === 0) {
            if (visit && !visit.done) finish(visit.pulled ? "lotki wyj\u0119te" : "tarcza pusta");
            visit = null;
            return;
          }

          if (visit) {
            const differs = !sameStart(st.darts, visit.darts) || (st.count < visit.darts.length && !pulling && (visit.pulled || visit.done));
            if (visit.done) {
              // already sent (or skipped): wait for the empty board or clearly new darts
              if (differs && !pulling) visit = fresh(st, now, throwing);
              else return;
            } else if (visit.pulled && !pulling) {
              // takeout over, state back to "throw"
              finish("koniec wyjmowania");
              if (differs) visit = fresh(st, now, throwing);
              else return;
            } else if (!pulling && st.count < visit.darts.length && !sameStart(st.darts, visit.darts)) {
              // missed the empty board between two visits
              finish("nowa tura bez pustej tarczy");
              visit = fresh(st, now, throwing);
            }
          }

          if (!visit) visit = fresh(st, now, throwing);
          // during a takeout darts vanish one by one: never shrink the visit then
          else if (!pullingRaw || st.count >= visit.darts.length) visit.darts = st.darts.slice();
          if (throwing) visit.sawThrow = true;
          if (pulling && visit.sawThrow) visit.pulled = true;
        }
      };
    }

    // Autodarts match state (channel "autodarts.matches", GET /gs/v0/matches/<id>/state).
    // turns[0] is the turn in progress; to be safe the turn of the current round and player is preferred.
    function parseMatch(d) {
      if (!d || typeof d !== "object" || typeof d.id !== "string" || !Array.isArray(d.turns)) return null;
      const players = Array.isArray(d.players) ? d.players : [];
      const pIdx = typeof d.player === "number" ? d.player : 0;
      const pid = players[pIdx] && players[pIdx].id;
      const turn = d.turns.find(t => t && (d.round == null || t.round === d.round) && (!pid || !t.playerId || t.playerId === pid)) || d.turns[0] || null;
      const throws = turn && Array.isArray(turn.throws) ? turn.throws : [];
      const darts = throws.map(t => { const x = normalizeThrow(t); if (x) x.raw = t; return x; }).filter(Boolean);
      const round = turn && turn.round != null ? turn.round : d.round;
      return {
        matchId: d.id,
        key: [d.set != null ? d.set : 0, d.leg != null ? d.leg : 0, round, pIdx].join("."),
        darts,
        player: pIdx,
        playerName: players[pIdx] && (players[pIdx].name || players[pIdx].id) || "",
        round,
        variant: String(d.variant || (d.settings && d.settings.variant) || ""),
        finished: d.finished === true || d.gameFinished === true,
        busted: turn ? turn.busted : undefined,
        points: turn ? turn.points : undefined,
        settings: d.settings && typeof d.settings === "object"
          ? { order: d.settings.order, mode: d.settings.mode, hits: d.settings.hits } : null
      };
    }

    // One visit per Autodarts turn, published when the turn is over: the turn key changes
    // (takeout -> next player / next round) or the leg/match is finished. Corrections made
    // before that moment are part of the state, so they are in the visit.
    function createMatchTracker(onVisit, log) {
      log = log || function () {};
      let cur = null, epoch = "";
      const sent = new Set();
      const sig = d => d.map(x => x.label).join(" ");
      // epoch: set after an AutoDarts reset (the restarted leg can repeat turn keys, its visits must get new ids)
      const idOf = t => t.matchId + "/" + t.key + (epoch ? "~" + epoch : "");
      function publish(t, reason) {
        if (!t || !t.darts.length) return;
        const id = idOf(t);
        if (sent.has(id)) return;
        sent.add(id);
        onVisit({ id, darts: t.darts.slice(0, 3), extraDarts: Math.max(0, t.darts.length - 3), reason, matchId: t.matchId, key: t.key,
          busted: t.busted, points: t.points, variant: t.variant, settings: t.settings, finished: !!t.finished });
      }
      return {
        current() { return cur; },
        epoch() { return epoch; },
        // after a reset: forget the old turns, the next state is the new baseline (darts already in it are not lost)
        reset(newEpoch) { cur = null; sent.clear(); epoch = newEpoch || ""; },
        update(m) {
          if (!m) return;
          if (cur && cur.matchId !== m.matchId) { log("Nowy mecz w Autodarts: " + m.matchId); cur = null; }
          if (!cur) {
            cur = m;
            if (m.finished) sent.add(idOf(m)); // leg already over when we joined
            else if (m.darts.length) log("Start: tura w toku: " + sig(m.darts));
            return;
          }
          if (m.key !== cur.key) {
            if (sent.has(idOf(m))) {
              // undo back into a turn that was already sent: send nothing, neither that turn nor the current one
              log("Autodarts wr\u00f3ci\u0142 do tury " + m.key + " (cofni\u0119cie). Ta tura ju\u017c jest w DartCounter. Nic nie wysy\u0142am, popraw DartCounter r\u0119cznie.");
            } else {
              publish(cur, "nast\u0119pna tura");
            }
            cur = m;
          } else if (!m.darts.length && cur.darts.length >= 2) {
            // same turn jumps from 2-3 darts to none (not a single undo): keep what we saw, do not lose the visit
            cur = Object.assign({}, m, { darts: cur.darts });
            log("Tura " + m.key + " nagle bez lotek w stanie meczu, zostawiam ostatnio widziane: " + sig(cur.darts));
          } else {
            cur = m;
          }
          if (m.finished) publish(cur, "koniec lega/meczu");
        }
      };
    }

    // ----- dart sounds -----
    // Sound for one dart: "laugh" (S1/D1/T1), "cheer" (T20), "boo" (miss), or null.
    function dartSound(d) {
      if (!d || d.ok === false) return null;
      if (d.multiplier === 0) return "boo";
      if (d.number === 1 && d.multiplier >= 1 && d.multiplier <= 3) return "laugh";
      if (d.number === 20 && d.multiplier === 3) return "cheer";
      return null;
    }
    const COMBO = ["S1", "S5", "S20"];
    function comboPossible(darts) {
      if (darts.length > 3) return false;
      const labels = darts.map(d => d && d.label);
      return labels.every(l => COMBO.includes(l)) && new Set(labels).size === labels.length;
    }
    function isCombo(darts) { return darts.length === 3 && comboPossible(darts); }

    // Feed it the darts of the current turn after every update (repeats are fine).
    // key = turn id (game: match/turn, the turn ends when the key changes; an empty turn = undo).
    // Local board: constant key and emptyEndsTurn = true (darts pulled = end of the turn).
    // Calls onSound(name, why) for every NEW dart. The S1 laugh waits while S1 + S5 + S20 is still
    // possible: the combo replaces it; if the combo breaks, the laugh plays then (or the newer dart's
    // own sound plays instead), and at the end of a turn without combo.
    // The first update is the baseline: darts already there make no sound.
    function createSoundRules(onSound) {
      let turn = null;
      function endTurn(why) {
        if (turn && turn.pending) onSound("laugh", "S1 (" + why + ")");
        if (turn) turn.pending = false;
      }
      return {
        update(key, darts, emptyEndsTurn) {
          darts = (darts || []).filter(Boolean);
          if (!turn) { turn = { key, n: darts.length, pending: false }; return; }
          if (key !== turn.key) { endTurn("koniec tury"); turn = { key, n: 0, pending: false }; }
          if (emptyEndsTurn && darts.length === 0 && turn.n > 0) { endTurn("koniec tury"); turn.n = 0; return; }
          if (darts.length < turn.n) { // undo / correction removed darts
            turn.n = darts.length;
            if (turn.pending && !(darts.some(d => d.label === "S1") && comboPossible(darts))) turn.pending = false;
            return;
          }
          for (let i = turn.n; i < darts.length; i++) {
            const prefix = darts.slice(0, i + 1), d = darts[i];
            if (isCombo(prefix)) { turn.pending = false; onSound("combo", "S1 + S5 + S20"); continue; }
            const own = dartSound(d);
            if (d.label === "S1" && comboPossible(prefix)) { turn.pending = true; continue; }
            if (turn.pending && !comboPossible(prefix)) {
              turn.pending = false;
              if (own) onSound(own, d.label); else onSound("laugh", "S1");
              continue;
            }
            if (own) onSound(own, d.label);
          }
          turn.n = darts.length;
        }
      };
    }

    // ----- Around the Clock -----
    // DartCounter ATC settings (localStorage "localAroundTheClockSettings", saved when the game starts).
    const ATC_DEFAULTS = { bullOrBullseye: "bullseye", throwOrder: "low_to_high", numberSegment: "all", hit: "once", increaseGoalByMultiplier: false };
    function atcDcConfig(stored) {
      const c = Object.assign({}, ATC_DEFAULTS, stored && typeof stored === "object" ? stored : {});
      const cfg = { throwout: c.bullOrBullseye, segment: c.numberSegment, hits: c.hit, order: c.throwOrder, bySegment: !!c.increaseGoalByMultiplier };
      if (c.throwOrder !== "low_to_high") return Object.assign(cfg, { ok: false, why: "kolejno\u015b\u0107 \u201e" + c.throwOrder + "\u201d w DartCounter (obs\u0142ugiwana tylko 1 \u2192 20, potem bull)" });
      if (cfg.bySegment) return Object.assign(cfg, { ok: false, why: "w DartCounter w\u0142\u0105czone \u201eIncrease by segment\u201d (obs\u0142ugiwany tylko 1 cel na trafienie)" });
      if (!["all", "single", "double", "triple"].includes(c.numberSegment)) return Object.assign(cfg, { ok: false, why: "segmenty \u201e" + c.numberSegment + "\u201d w DartCounter nie s\u0105 obs\u0142ugiwane" });
      if (!["bullseye", "bull", "all"].includes(c.bullOrBullseye)) return Object.assign(cfg, { ok: false, why: "bull \u201e" + c.bullOrBullseye + "\u201d w DartCounter nie jest obs\u0142ugiwany" });
      if (!["once", "twice", "thrice"].includes(c.hit)) return Object.assign(cfg, { ok: false, why: "liczba trafie\u0144 \u201e" + c.hit + "\u201d w DartCounter nie jest obs\u0142ugiwana" });
      return Object.assign(cfg, { ok: true, why: "" });
    }
    // Autodarts ATC settings vs DartCounter: order must be 1-20-Bull, mode and hits must match.
    // (The bull itself is DartCounter's call: Autodarts may also finish on 25, DartCounter "bullseye" only on 50.)
    const AD_MODE = { "Full": "all", "Single": "single", "Double": "double", "Triple": "triple" };
    const AD_HITS = { 1: "once", 2: "twice", 3: "thrice" };
    function atcAutodartsCheck(ad, dc) {
      if (!ad) return { ok: true, why: "" }; // local board: no game settings, DartCounter decides
      if (ad.order != null && ad.order !== "1-20-Bull") return { ok: false, why: "kolejno\u015b\u0107 Autodarts \u201e" + ad.order + "\u201d nie jest obs\u0142ugiwana (tylko 1-20-Bull)" };
      if (ad.mode != null && !AD_MODE[ad.mode]) return { ok: false, why: "tryb Autodarts \u201e" + ad.mode + "\u201d nie jest obs\u0142ugiwany (Full, Single, Double, Triple)" };
      if (ad.mode != null && AD_MODE[ad.mode] !== dc.segment) return { ok: false, why: "tryb Autodarts \u201e" + ad.mode + "\u201d \u2260 segmenty DartCounter \u201e" + dc.segment + "\u201d" };
      if (ad.hits != null && AD_HITS[Number(ad.hits)] !== dc.hits) return { ok: false, why: "trafienia Autodarts " + ad.hits + " \u2260 DartCounter \u201e" + dc.hits + "\u201d" };
      return { ok: true, why: "" };
    }
    // Which DartCounter ATC key a dart presses for the current target (DartCounter's own rules):
    // target { kind: "number", n } or { kind: "bull" }. Returns "S" | "D" | "T" | "hit" | "bull" | "singlebull" | "bullseye" | "miss".
    function atcKey(d, target, cfg) {
      if (!d || d.ok === false || !target) return "miss";
      const m = d.multiplier;
      if (target.kind === "bull") {
        if (d.number !== 25 || !(m === 1 || m === 2)) return "miss";
        if (cfg.throwout === "bullseye") return m === 2 ? "bull" : "miss";
        if (cfg.throwout === "bull") return m === 1 ? "bull" : "miss";
        return m === 1 ? "singlebull" : "bullseye";
      }
      if (d.number !== target.n || !(m >= 1 && m <= 3)) return "miss";
      if (cfg.segment === "all") return ["", "S", "D", "T"][m];
      const need = { single: 1, double: 2, triple: 3 }[cfg.segment];
      return m === need ? "hit" : "miss";
    }
    // Which DartCounter page may take a visit of this Autodarts variant ("x01" | "atc").
    function visitFits(variant, page) {
      if (!variant) return true; // local board or unknown: as before
      return page === "atc" ? variant === "ATC" : variant === "X01";
    }

    // ----- bull fireworks -----
    // "big" for the bullseye (50), "small" for the outer bull (25), else null.
    function bullKind(d) {
      if (!d || d.ok === false || d.number !== 25) return null;
      return d.multiplier === 2 ? "big" : d.multiplier === 1 ? "small" : null;
    }
    // Reports every dart that is NEW since the previous call (same rules as the sounds:
    // first call = baseline, new key = new turn, fewer darts = undo/empty board lowers the baseline).
    function createNewDarts(onDart) {
      let prev = null;
      return {
        update(key, darts) {
          darts = (darts || []).filter(Boolean);
          if (!prev) { prev = { key, n: darts.length }; return; }
          const from = key !== prev.key ? 0 : Math.min(prev.n, darts.length);
          for (let i = from; i < darts.length; i++) onDart(darts[i], i);
          prev = { key, n: darts.length };
        }
      };
    }

    // Score to enter for a visit.
    // remaining: current player's rest (or null). reliable: true when we are sure it is the current player.
    function decideScore(darts, remaining, reliable, doubleOut) {
      const total = darts.reduce((a, d) => a + d.score, 0);
      if (remaining == null || !(remaining > 0)) return { score: total, total, note: "" };
      let rest = remaining;
      for (const d of darts) {
        rest -= d.score;
        if (rest === 0) {
          if (!doubleOut || d.multiplier === 2) return { score: remaining, total, note: "zako\u0144czenie" };
          return { score: 0, total, note: "koniec bez podw\u00f3jnej = przerzucenie" };
        }
        if (reliable && (rest < 0 || (doubleOut && rest === 1))) return { score: 0, total, note: "przerzucenie (reszta " + remaining + ")" };
        if (rest < 0) break; // not reliable: DartCounter validates busts itself
      }
      return { score: total, total, note: "" };
    }

    // Answer for the DartCounter dialog "Darts used on a double" / "Darts used for checkout".
    // DartCounter counts a dart at a double while the rest before it is 50 or an even number 2..40 (double out).
    // rest: the player's rest before the visit (null = unknown). isFinish: the dialog asks for checkout darts.
    function simulateCheckout(darts, rest) {
      let r = rest, atDouble = 0;
      for (let i = 0; i < darts.length; i++) {
        const d = darts[i];
        if (r === 50 || (r >= 2 && r <= 40 && r % 2 === 0)) atDouble++;
        const nr = r - d.score;
        if (nr === 0 && d.multiplier === 2) return { atDouble, forCheckout: i + 1, finished: true, bust: false };
        if (nr < 2) return { atDouble, forCheckout: null, finished: false, bust: true };
        r = nr;
      }
      return { atDouble, forCheckout: null, finished: false, bust: false };
    }
    function checkoutAnswer(darts, rest, isFinish) {
      const ds = (darts || []).filter(d => d && d.ok !== false).slice(0, 3);
      let sim = rest != null && rest > 0 ? Object.assign(simulateCheckout(ds, rest), { exact: true }) : null;
      if (isFinish && (!sim || !sim.finished) && ds.length) {
        // checkout without a matching rest: the finishing dart is the last double of the visit
        let k = -1;
        ds.forEach((d, i) => { if (d.multiplier === 2) k = i; });
        if (k < 0) k = ds.length - 1;
        const r = ds.slice(0, k + 1).reduce((a, d) => a + d.score, 0);
        sim = Object.assign(simulateCheckout(ds, r), { exact: false });
        if (!sim.finished) sim = { atDouble: 1, forCheckout: k + 1, finished: true, bust: false, exact: false };
      }
      return sim || { atDouble: 0, forCheckout: null, finished: false, bust: false, exact: false };
    }
    // nearest value DartCounter offers (ties: the smaller one); null when nothing is offered
    function pickOption(value, options) {
      const opts = (options || []).filter(x => typeof x === "number" && !isNaN(x));
      if (!opts.length) return null;
      if (value == null) return opts[0];
      return opts.reduce((best, x) => Math.abs(x - value) < Math.abs(best - value) || (Math.abs(x - value) === Math.abs(best - value) && x < best) ? x : best, opts[0]);
    }

    // ----- AutoDarts reset when a DartCounter leg ends -----
    // New leg in DartCounter: every rest jumps to the same start value and somebody had a finishable rest (<= 170) before.
    // An undo never matches: it changes one player and the values are not all the start score.
    function legEndFromRests(prev, cur, startScore) {
      if (!prev || !cur || !cur.length || prev.length !== cur.length) return false;
      if (cur.some(x => x == null) || prev.some(x => x == null)) return false;
      const x = cur[0];
      if (cur.some(y => y !== x)) return false;
      if (startScore != null ? x !== startScore : x < 301) return false;
      return prev.every(p => p <= x) && prev.some(p => p < x && p <= 170);
    }
    // legs counter: one player's sets or legs + 1 (a won set: sets + 1 and every legs count back to 0); never a decrease
    // otherwise (undo). Readings: per player [sets, legs] or [legs].
    function interimLegEnd(prev, cur) {
      if (!prev || !cur || !cur.length || prev.length !== cur.length || cur.some((x, i) => x.length !== prev[i].length)) return false;
      let up = 0, setUp = false, down = false;
      for (let i = 0; i < cur.length; i++) {
        for (let j = 0; j < cur[i].length; j++) {
          const d = cur[i][j] - prev[i][j];
          if (d === 1) { up++; if (cur[i].length === 2 && j === 0) setUp = true; }
          else if (d > 1) return false;
          else if (d < 0) { if (cur[i].length === 2 && j === 1 && cur[i][j] === 0) down = true; else return false; }
        }
      }
      if (down && !setUp) return false;
      return up >= 1;
    }
    // mode: "leg" (every leg end, also the last one of the match), "lost" (only a lost leg or match), "match" (match end), "off"
    function resetWanted(mode, kind, won) {
      if (mode === "leg") return true;
      if (mode === "lost") return !won;
      if (mode === "match") return kind === "match";
      return false;
    }
    // what AutoDarts needs for a fresh X01 start, from its match state (same rules as its own Next button)
    function resetPlan(raw) {
      if (!raw || typeof raw !== "object") return null;
      const noMatchMode = !raw.sets && !raw.legs;
      if (raw.gameFinished || (raw.finished && noMatchMode)) return "next";
      if (raw.finished) return "again";
      return "restart";
    }
    // Around the Clock, mode Full: Autodarts counts the outer bull (25) on the bull target. DartCounter with "Finish by
    // hitting the bullseye" wants 50. Returns the turn index of a new S25 thrown at the bull target (from the previous
    // state: same match, same player, target number 25/50), else -1. Any other variant or mode: -1.
    function atcOuterBullThrow(prev, raw) {
      if (!prev || !raw || prev.id !== raw.id || !/^atc$/i.test(String(raw.variant || ""))) return -1;
      if (!raw.settings || raw.settings.mode !== "Full") return -1;
      const p = typeof raw.player === "number" ? raw.player : 0;
      if ((typeof prev.player === "number" ? prev.player : 0) !== p) return -1;
      const ps = prev.state || {};
      const tgt = ps.targets && ps.targets[p] && ps.currentTargets ? ps.targets[p][ps.currentTargets[p]] : null;
      if (!tgt || (tgt.number !== 25 && tgt.number !== 50)) return -1;
      const a = parseMatch(prev), b = parseMatch(raw);
      if (!a || !b || a.key !== b.key || b.darts.length !== a.darts.length + 1) return -1;
      const d = b.darts[b.darts.length - 1];
      return d && d.number === 25 && d.multiplier === 1 ? b.darts.length - 1 : -1;
    }

    // fresh leg: every score is the start score and nobody has thrown yet in it
    function isFreshLeg(raw) {
      if (raw && /atc|around/i.test(String(raw.variant || "")) && !raw.finished && !raw.gameFinished) // Around the Clock: nobody has thrown yet
        return (raw.turns || []).every(t => !t || !Array.isArray(t.throws) || !t.throws.length);
      if (!raw || !Array.isArray(raw.gameScores) || !raw.gameScores.length || raw.finished || raw.gameFinished) return false;
      const base = raw.settings && raw.settings.baseScore;
      if (base == null || raw.gameScores.some(x => x !== base)) return false;
      return (raw.turns || []).every(t => !t || !Array.isArray(t.throws) || !t.throws.length);
    }

    return { toNum, parseLabel, normalizeThrow, normalizeState, isPulling, createTracker, decideScore, keyOf, applyOverrides, parseMatch, createMatchTracker,
      dartSound, comboPossible, isCombo, createSoundRules, bullKind, createNewDarts,
      atcDcConfig, atcAutodartsCheck, atcKey, visitFits, checkoutAnswer, pickOption, legEndFromRests, interimLegEnd, resetWanted, resetPlan, isFreshLeg, atcOuterBullThrow };
  })();

  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = Core;
    return;
  }

  // =====================================================================
  // Environment helpers
  // =====================================================================
  const CFG = {
    defaultApiBase: "http://127.0.0.1:3180",
    pollMs: 350,
    xhrTimeoutMs: 1500,
    sourceStaleMs: 3000,
    leaderStaleMs: 4000,
    visitMaxAgeMs: 120000,
    dupWindowMs: 10000,
    verifyMs: 3500,
    logPanelLines: 8,
    logKeepLines: 300
  };
  const RESET_MODES = { leg: "koniec ka\u017cdego lega", lost: "tylko po przegranym legu", match: "koniec meczu", off: "wy\u0142\u0105czony" };
  const K = {
    enabled: "ad2dc3_enabled",
    apiBase: "ad2dc3_api_base",
    panelOpen: "ad2dc3_panel_open",
    doubleOut: "ad2dc3_double_out",
    sendDelay: "ad2dc3_send_delay",
    entryMode: "ad2dc3_entry_mode",
    sounds: "ad2dc3_sounds",
    soundVolume: "ad2dc3_sound_volume",
    leader: "ad2dc3_leader",
    lastEntered: "ad2dc3_last_entered",
    relay: "ad2dc3_relay",
    source: "ad2dc3_source",
    playVisits: "ad2dc3_play_visits",
    playLive: "ad2dc3_play_live",
    playHb: "ad2dc3_play_hb",
    enteredIds: "ad2dc3_entered_ids",
    cloud: "ad2dc3_cloud",
    resetMode: "ad2dc3_reset_mode",
    resetCmd: "ad2dc3_reset_cmd",
    resetAck: "ad2dc3_reset_ack",
    playEpoch: "ad2dc3_play_epoch",
    atcDc: "ad2dc3_atc_dc",
    autoNext: "ad2dc3_auto_next"
  };

  const host = location.hostname.toLowerCase();
  const isDC = host === "app.dartcounter.net";
  const isPlay = host === "play.autodarts.io" || host === "play.autodarts.com";
  const isLocal = host === "127.0.0.1" || host === "localhost";
  const role = isDC ? "DartCounter" : isPlay ? "play.autodarts" : "AutoDarts (lokalnie)";

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();
  const hhmmss = t => new Date(t).toTimeString().slice(0, 8);

  const hasGM_ = typeof GM_getValue === "function";
  const hasGMdot = typeof GM !== "undefined" && GM && typeof GM.getValue === "function";

  async function gget(k, d) {
    try {
      if (hasGM_) return GM_getValue(k, d);
      if (hasGMdot) return await GM.getValue(k, d);
    } catch (e) { log("B\u0141\u0104D odczytu pami\u0119ci skryptu: " + errText(e)); }
    return d;
  }
  async function gset(k, v) {
    try {
      if (typeof GM_setValue === "function") return GM_setValue(k, v);
      if (typeof GM !== "undefined" && GM && typeof GM.setValue === "function") return await GM.setValue(k, v);
    } catch (e) { log("B\u0141\u0104D zapisu pami\u0119ci skryptu: " + errText(e)); }
  }
  function gxhr(url, timeout) {
    return new Promise((resolve, reject) => {
      const d = {
        method: "GET", url, timeout, nocache: true,
        onload: r => resolve({ status: r.status, text: r.responseText }),
        onerror: e => reject(new Error((e && (e.error || e.statusText)) || "brak po\u0142\u0105czenia")),
        ontimeout: () => reject(new Error("przekroczony czas")),
        onabort: () => reject(new Error("przerwane"))
      };
      try {
        if (typeof GM_xmlhttpRequest === "function") GM_xmlhttpRequest(d);
        else if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") {
          const p = GM.xmlHttpRequest(d);
          if (p && typeof p.catch === "function") p.catch(e => reject(e instanceof Error ? e : new Error(errText(e))));
        } else reject(new Error("mened\u017cer skrypt\u00f3w nie ma GM_xmlhttpRequest"));
      } catch (e) { reject(e); }
    });
  }
  function errText(e) {
    if (!e) return "nieznany b\u0142\u0105d";
    if (typeof e === "string") return e;
    return e.message || e.error || e.statusText || safeJson(e);
  }
  function safeJson(x, pretty) { try { return JSON.stringify(x, null, pretty ? 2 : 0); } catch (_) { return String(x); } }
  function managerName() {
    try { const i = typeof GM_info !== "undefined" ? GM_info : (typeof GM !== "undefined" && GM.info); if (i) return (i.scriptHandler || "?") + " " + (i.version || ""); } catch (_) {}
    return "nieznany";
  }

  // ---------- Log ----------
  const logBuf = [];
  function log(msg, data) {
    const line = hhmmss(now()) + " " + msg + (data !== undefined ? " " + safeJson(data) : "");
    if (data !== undefined) console.log(PREFIX, msg, data); else console.log(PREFIX, msg);
    const last = logBuf[logBuf.length - 1];
    if (last && last.msg === msg && data === undefined) { last.n++; last.line = line + " (x" + last.n + ")"; }
    else logBuf.push({ msg, n: 1, line });
    while (logBuf.length > CFG.logKeepLines) logBuf.shift();
    ui.render();
  }

  // ---------- Dart sounds: WebAudio player (unlocked by the first real click / key press) ----------
  const SOUND_BASE = "https://raw.githubusercontent.com/nixuuu/autodarts-dartcounter-bridge/main/sounds/";
  const SOUND_FILES = { laugh: "laugh-2.mp3", cheer: "cheer-2.mp3", boo: "boo-3.mp3", combo: "combo-6.mp3", fireworks: "fireworks-1.mp3" };
  const Sound = (() => {
    let ctx = null, loading = null, current = null, state = "zablokowany do pierwszego klikni\u0119cia";
    const buffers = {};
    const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;

    function fetchArrayBuffer(url) {
      return new Promise((resolve, reject) => {
        const d = {
          method: "GET", url, timeout: 15000, responseType: "arraybuffer",
          onload: r => (r.status === 200 && r.response && typeof r.response.byteLength === "number" ? resolve(r.response) : reject(new Error("HTTP " + r.status))),
          onerror: () => reject(new Error("brak po\u0142\u0105czenia")), ontimeout: () => reject(new Error("przekroczony czas"))
        };
        try {
          if (typeof GM_xmlhttpRequest === "function") GM_xmlhttpRequest(d);
          else if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") {
            const p = GM.xmlHttpRequest(d);
            if (p && typeof p.catch === "function") p.catch(() => reject(new Error("GM.xmlHttpRequest")));
          } else reject(new Error("brak GM_xmlhttpRequest"));
        } catch (e) { reject(e); }
      });
    }
    function decode(ab) {
      return new Promise((resolve, reject) => {
        try { const p = ctx.decodeAudioData(ab, resolve, reject); if (p && typeof p.catch === "function") p.catch(reject); } catch (e) { reject(e); }
      });
    }
    function load() {
      if (loading || !ctx) return loading;
      state = "\u0142aduj\u0119 d\u017awi\u0119ki";
      loading = (async () => {
        for (const name of Object.keys(SOUND_FILES)) {
          try { buffers[name] = await decode(await fetchArrayBuffer(SOUND_BASE + SOUND_FILES[name])); }
          catch (e) { log("D\u017awi\u0119k " + SOUND_FILES[name] + " nie wczytany: " + errText(e)); }
        }
        const n = Object.keys(buffers).length;
        state = n ? "gotowe (" + n + "/" + Object.keys(SOUND_FILES).length + ")" : "brak d\u017awi\u0119k\u00f3w (b\u0142\u0105d pobierania)";
        ui.render();
      })();
      return loading;
    }
    // Call from a real user gesture (click / key press). Safe to call many times.
    function unlock() {
      if (!AC) { state = "przegl\u0105darka bez WebAudio"; return; }
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === "suspended" && typeof ctx.resume === "function") ctx.resume().catch(() => {});
        const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); // silent tick: unlocks Safari
        src.buffer = b; src.connect(ctx.destination); src.start(0);
        unlocked = true;
        load();
      } catch (e) { state = "niedost\u0119pne"; }
    }
    // Safari may suspend or "interrupt" the context later (other window, sleep): resume quietly, never throw.
    let unlocked = false;
    function resume() {
      try { if (ctx && unlocked && ctx.state !== "running" && ctx.state !== "closed" && ctx.resume) ctx.resume().catch(() => {}); } catch (_) {}
    }
    try { document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); }); } catch (_) {}
    function start(name, volume) {
      try {
        if (!ctx || ctx.state !== "running" || !buffers[name]) return false;
        if (current) { try { current.stop(0); } catch (_) {} current = null; }
        const src = ctx.createBufferSource(), gain = ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume));
        src.buffer = buffers[name]; src.connect(gain); gain.connect(ctx.destination);
        src.onended = () => { if (current === src) current = null; };
        src.start(0);
        current = src;
        return true;
      } catch (_) { return false; }
    }
    // Fire-and-forget, never throws. A new sound stops the one that is playing.
    function play(name, volume) {
      if (ctx && unlocked && ctx.state !== "running" && buffers[name] && ctx.resume) {
        try { ctx.resume().then(() => start(name, volume), () => {}); } catch (_) {}
        return true;
      }
      return start(name, volume);
    }
    function stop() { if (current) { try { current.stop(0); } catch (_) {} current = null; } }
    return {
      unlock, play, stop,
      get state() { return ctx && ctx.state !== "running" ? (unlocked ? "wstrzymane (" + ctx.state + "), wznowi si\u0119" : "zablokowane do pierwszego klikni\u0119cia") : state; },
      get ready() { return !!(ctx && ctx.state === "running" && Object.keys(buffers).length); }
    };
  })();

  // ---------- Bull fireworks: light canvas overlay, never blocks clicks ----------
  const Fireworks = (() => {
    const LIFE_MS = 2600;
    let canvas = null, ctx = null, parts = [], timers = [], running = false, until = 0, w = 0, h = 0, dpr = 1, last = 0, watchdog = 0;
    // Called on window: WebKit throws "Can only call Window.requestAnimationFrame on instances of Window" for an
    // unbound call from a userscript sandbox. Falls back to a 16 ms timer.
    function raf(cb) {
      try {
        const r = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
        if (typeof r === "function") return r.call(window, cb);
      } catch (_) {}
      return setTimeout(() => cb(now()), 16);
    }
    function reducedMotion() {
      try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; }
    }
    function ensure() {
      if (canvas && canvas.isConnected) return;
      canvas = document.createElement("canvas");
      canvas.id = "ad2dc-fireworks";
      canvas.setAttribute("aria-hidden", "true");
      // inset 0 instead of 100vw/100vh: no scrollbar width, same box in Safari and Chrome
      Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", right: "0", bottom: "0", width: "100%", height: "100%",
        margin: "0", padding: "0", border: "0", display: "block", pointerEvents: "none", zIndex: "2147483646", opacity: "0.85",
        background: "transparent" });
      document.documentElement.appendChild(canvas);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      w = Math.round((box && box.width) || document.documentElement.clientWidth || window.innerWidth || 800);
      h = Math.round((box && box.height) || document.documentElement.clientHeight || window.innerHeight || 600);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      try { ctx = canvas.getContext ? canvas.getContext("2d") : null; } catch (_) { ctx = null; }
      if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function remove() {
      running = false; parts = [];
      for (const t of timers) clearTimeout(t);
      timers = [];
      clearTimeout(watchdog);
      if (canvas) canvas.remove();
      canvas = null; ctx = null;
    }
    function explode(x, y, count, speed) {
      const hue = Math.floor(Math.random() * 360);
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.2, v = speed * (0.55 + Math.random() * 0.45);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.012 + Math.random() * 0.01,
          size: 1.5 + Math.random() * 1.8, color: "hsl(" + ((hue + Math.random() * 40) % 360) + ",100%,62%)" });
      }
    }
    // Motion is time based (k = elapsed / 16.7 ms): the same speed and length at 60 Hz (Safari) and 120 Hz.
    function frame(ts) {
      if (!running) return;
      const t = typeof ts === "number" && ts > 0 ? ts : now();
      const k = last ? Math.max(0.25, Math.min(4, (t - last) / 16.667)) : 1;
      last = t;
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        const drag = Math.pow(0.985, k);
        for (const p of parts) {
          p.vy += 0.045 * k; p.vx *= drag; p.vy *= drag; p.x += p.vx * k; p.y += p.vy * k; p.life -= p.decay * k;
          if (p.life <= 0) continue;
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      parts = parts.filter(p => p.life > 0);
      if (now() >= until) { remove(); return; }
      raf(frame);
    }
    // kind "big" (bullseye 50) or "small" (outer bull 25). Bursts sit in the upper part and at the sides.
    function burst(kind) {
      try {
        if (!document.documentElement) return false;
        ensure();
        const big = kind === "big", calm = reducedMotion();
        const spots = calm ? [[0.5, 0.15]] : big
          ? [[0.12, 0.18], [0.3, 0.1], [0.5, 0.16], [0.7, 0.1], [0.88, 0.18], [0.2, 0.32], [0.8, 0.32]]
          : [[0.15, 0.15], [0.85, 0.15]];
        const count = calm ? 30 : big ? 70 : 40, speed = big ? 4.2 : 3;
        spots.forEach(([fx, fy], i) => {
          timers.push(setTimeout(() => explode(fx * w, fy * h, count, speed), calm ? 0 : i * (big ? 140 : 220)));
        });
        canvas.dataset.size = big ? "big" : "small";
        canvas.dataset.bursts = String((Number(canvas.dataset.bursts) || 0) + spots.length);
        until = now() + LIFE_MS + (calm ? 0 : spots.length * (big ? 140 : 220));
        // removed by a timer as well: a hidden tab gets no animation frames (Safari pauses them)
        clearTimeout(watchdog);
        watchdog = setTimeout(remove, until - now() + 400);
        if (!running) { running = true; last = 0; raf(frame); }
        return true;
      } catch (_) { return false; }
    }
    return { burst, remove, get active() { return !!(canvas && canvas.isConnected); } };
  })();

  // ---------- Clipboard ----------
  async function copyText(text) {
    try { if (typeof GM_setClipboard === "function") { GM_setClipboard(text, "text"); return true; } } catch (_) {}
    try { if (typeof GM !== "undefined" && GM && typeof GM.setClipboard === "function") { await GM.setClipboard(text, "text"); return true; } } catch (_) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove();
      if (ok) return true;
    } catch (_) {}
    return false;
  }

  // =====================================================================
  // Panel (Shadow DOM, collapsed by default, fixed size)
  // =====================================================================
  const ui = (() => {
    const f = {}; // field values
    let rootEl = null, sh = null, open = false, mounted = false, renderQueued = false;
    const buttons = [];
    let stripJson = "", pickSlot = null, pickMult = 1, onPick = null, quickKey = "", onQuick = null;
    // speaker icons (inline SVG, plain ASCII in the file)
    const SPEAKER = '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/>';
    const ICON_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      SPEAKER + '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
    const ICON_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      SPEAKER + '<path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>';

    function set(k, v) { if (f[k] !== v) { f[k] = v; render(); } }
    function addButton(id, label, fn) { buttons.push({ id, label, fn }); }
    const sliders = [];
    function addSlider(id, label, get, onInput) { sliders.push({ id, label, get, onInput }); }

    function mount(isOpen) {
      if (mounted) return;
      if (!document.body) { document.addEventListener("DOMContentLoaded", () => mount(isOpen), { once: true }); return; }
      mounted = true; open = !!isOpen;
      rootEl = document.createElement("div");
      rootEl.id = "ad2dc-root";
      Object.assign(rootEl.style, { position: "fixed", right: "8px", bottom: "8px", zIndex: "2147483647" });
      sh = rootEl.attachShadow({ mode: "open" });
      sh.innerHTML = `
<style>
  :host { all: initial; }
  [hidden] { display: none !important; }
  .pill { font: 600 11px/1 -apple-system, system-ui, sans-serif; background: #111827; color: #e5e7eb; border-radius: 999px;
          padding: 6px 10px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.35); display: inline-flex; gap: 6px; align-items: center; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: #9ca3af; }
  .box { width: 330px; max-height: 360px; overflow: hidden; display: flex; flex-direction: column; gap: 4px;
         font: 11px/1.35 ui-monospace, Menlo, monospace; background: rgba(17,24,39,.96); color: #e5e7eb;
         border-radius: 8px; padding: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.4); }
  .row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row b { color: #9ca3af; font-weight: 400; }
  .err { color: #fca5a5; white-space: normal; }
  .hint { color: #fde68a; white-space: normal; }
  .log { color: #9ca3af; white-space: pre; overflow: hidden; border-top: 1px solid #374151; padding-top: 4px; }
  .btns { display: flex; flex-wrap: wrap; gap: 4px; }
  button { font: 11px -apple-system, system-ui, sans-serif; padding: 3px 6px; border-radius: 4px; border: 1px solid #4b5563;
           background: #374151; color: #fff; cursor: pointer; }
  textarea { width: 100%; height: 80px; font: 10px monospace; }
  .wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .row1 { display: flex; gap: 6px; align-items: center; }
  .snd { width: 30px; height: 30px; padding: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
         background: #111827; border: 2px solid #22c55e; color: #22c55e; box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer; }
  .snd.off { border-color: #6b7280; color: #9ca3af; }
  .snd:hover { filter: brightness(1.25); }
  .strip { display: flex; gap: 4px; align-items: center; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 4px 6px;
           font: 600 12px/1 -apple-system, system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
  .strip .t { font-weight: 400; color: #9ca3af; font-size: 11px; }
  .chip { min-width: 40px; padding: 5px 4px; background: #374151; border-color: #4b5563; font-weight: 600; font-size: 12px; }
  .chip.ed { background: #92400e; border-color: #f59e0b; }
  .picker { background: #111827; border-radius: 8px; padding: 6px; box-shadow: 0 2px 10px rgba(0,0,0,.45); width: 214px;
            display: flex; flex-direction: column; gap: 4px; font: 11px -apple-system, system-ui, sans-serif; color: #e5e7eb; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; }
  .grid button, .mrow button, .xrow button { padding: 5px 0; }
  .mrow, .xrow { display: grid; gap: 3px; }
  .mrow { grid-template-columns: repeat(3, 1fr); }
  .xrow { grid-template-columns: repeat(3, 1fr); }
  .on { background: #2563eb; border-color: #3b82f6; }
</style>
<div class="wrap">
<div class="picker" id="picker" hidden></div>
<div class="strip" id="strip" hidden></div>
<div class="row1"><button type="button" class="snd" id="snd" hidden></button>
<div class="pill" id="pill"><span class="dot" id="dot"></span><span id="pilltxt">AD2DC</span></div></div>
<div class="box" id="box" hidden>
  <div class="row"><b>AD2DC ${VERSION}</b> \u00b7 ${role} \u00b7 <span id="mgr"></span></div>
  <div id="rows"></div>
  <div class="hint" id="hint"></div>
  <div class="err" id="err"></div>
  <div class="btns" id="btns"></div>
  <div id="sliders"></div>
  <textarea id="manual" hidden readonly></textarea>
  <div class="log" id="log"></div>
</div>
</div>`;
      sh.getElementById("pill").addEventListener("click", () => toggle(true));
      sh.getElementById("snd").addEventListener("click", ev => { ev.stopPropagation(); if (onQuick) onQuick(); });
      sh.getElementById("strip").addEventListener("click", ev => {
        const b = ev.target.closest && ev.target.closest("[data-slot]");
        if (!b) return;
        ev.stopPropagation();
        const slot = Number(b.dataset.slot);
        pickSlot = pickSlot === slot ? null : slot;
        const cur = (f.strip && f.strip.slots[slot]) || null;
        pickMult = cur && cur.mult >= 1 && cur.mult <= 3 && cur.num !== 25 ? cur.mult : 1;
        renderPicker();
      });
      sh.getElementById("picker").addEventListener("click", ev => {
        const b = ev.target.closest && ev.target.closest("button");
        if (!b) return;
        ev.stopPropagation();
        if (b.dataset.m) { pickMult = Number(b.dataset.m); renderPicker(); return; }
        const slot = pickSlot;
        let choice;
        if (b.dataset.n) choice = ["", "S", "D", "T"][pickMult] + b.dataset.n;
        else if (b.dataset.x) choice = b.dataset.x;
        else return;
        pickSlot = null; renderPicker();
        if (choice !== "close" && onPick && slot != null) onPick(slot, choice);
      });
      sh.getElementById("mgr").textContent = managerName();
      const sw = sh.getElementById("sliders");
      for (const sl of sliders) {
        const row = document.createElement("label");
        row.className = "row"; row.dataset.id = sl.id;
        row.innerHTML = `<span class="sl-l"></span> <input type="range" min="0" max="100" step="5" style="width:150px;vertical-align:middle">`;
        const input = row.querySelector("input");
        input.value = String(sl.get());
        input.addEventListener("input", ev => { ev.stopPropagation(); sl.onInput(Number(input.value)); render(); });
        input.addEventListener("click", ev => ev.stopPropagation());
        sw.appendChild(row);
      }
      const bw = sh.getElementById("btns");
      for (const b of buttons) {
        const el = document.createElement("button");
        el.type = "button"; el.dataset.id = b.id; el.textContent = typeof b.label === "function" ? b.label() : b.label;
        el.addEventListener("click", async ev => { ev.stopPropagation(); try { await b.fn(el); } catch (e) { log("B\u0141\u0104D przycisku: " + errText(e)); } render(); });
        bw.appendChild(el);
      }
      document.documentElement.appendChild(rootEl);
      renderStrip();
      render();
    }

    function toggle(v) { open = v; gset(K.panelOpen, v); render(); }

    // strip model: { title, slots: [{ label, edited, mult, num } | null] x3, note } or null
    function setStrip(model, pickHandler) {
      onPick = pickHandler || onPick;
      const j = JSON.stringify(model || null);
      if (j === stripJson) return;
      stripJson = j; f.strip = model;
      if (!model) pickSlot = null;
      renderStrip(); renderPicker();
    }
    function renderStrip() {
      if (!sh) return;
      const el = sh.getElementById("strip");
      const m = f.strip;
      el.hidden = !m;
      if (!m) { el.innerHTML = ""; return; }
      el.innerHTML = `<span class="t">${esc(m.title)}</span>` + m.slots.map((x, i) =>
        `<button type="button" class="chip${x && x.edited ? " ed" : ""}" data-slot="${i}" title="Kliknij, \u017ceby poprawi\u0107">${esc(x ? x.label : "\u2013")}</button>`).join("") +
        (m.note ? `<span class="t">${esc(m.note)}</span>` : "");
    }
    function renderPicker() {
      if (!sh) return;
      const el = sh.getElementById("picker");
      if (pickSlot == null || !f.strip) { el.hidden = true; el.innerHTML = ""; return; }
      el.hidden = false;
      const mb = (m, l) => `<button type="button" data-m="${m}" class="${pickMult === m ? "on" : ""}">${l}</button>`;
      let nums = "";
      for (let n = 1; n <= 20; n++) nums += `<button type="button" data-n="${n}">${n}</button>`;
      el.innerHTML = `<div>Lotka ${pickSlot + 1}: wybierz pole</div>` +
        `<div class="mrow">${mb(1, "S pojedyncze")}${mb(2, "D podw\u00f3jne")}${mb(3, "T potr\u00f3jne")}</div>` +
        `<div class="grid">${nums}</div>` +
        `<div class="xrow"><button type="button" data-x="25">25</button><button type="button" data-x="BULL">Bull 50</button><button type="button" data-x="M">Pud\u0142o</button></div>` +
        `<div class="xrow"><button type="button" data-x="auto">Jak AutoDarts</button><button type="button" data-x="del">Usu\u0144 lotk\u0119</button><button type="button" data-x="close">Zamknij</button></div>`;
    }
    function showManual(text) {
      if (!sh) return;
      const ta = sh.getElementById("manual");
      ta.hidden = false; ta.value = text; ta.focus(); ta.select();
    }

    function render() {
      if (!mounted || renderQueued) return;
      renderQueued = true;
      Promise.resolve().then(() => {
        renderQueued = false;
        if (!sh) return;
        if (rootEl && !rootEl.isConnected && document.documentElement) document.documentElement.appendChild(rootEl);
        sh.getElementById("pill").hidden = open;
        const q = f.quick, snd = sh.getElementById("snd");
        const qk = q ? (q.on ? "1" : "0") + "|" + q.title : "";
        if (qk !== quickKey) {
          quickKey = qk;
          snd.hidden = !q;
          if (q) {
            snd.innerHTML = q.on ? ICON_ON : ICON_OFF;
            snd.classList.toggle("off", !q.on);
            snd.dataset.on = q.on ? "1" : "0";
            snd.title = q.title; snd.setAttribute("aria-label", q.title); snd.setAttribute("aria-pressed", q.on ? "true" : "false");
          }
        }
        sh.getElementById("box").hidden = !open;
        sh.getElementById("dot").style.background = f.dot || "#9ca3af";
        sh.getElementById("pilltxt").textContent = f.pill || "AD2DC";
        if (!open) return;
        const rows = sh.getElementById("rows");
        const lines = (f.rows || []).map(([k, v]) => `<div class="row"><b>${esc(k)}:</b> ${esc(v)}</div>`).join("");
        if (rows.innerHTML !== lines) rows.innerHTML = lines;
        sh.getElementById("hint").textContent = f.hint || "";
        sh.getElementById("err").textContent = f.err ? "B\u0142\u0105d: " + f.err : "";
        for (const row of sh.getElementById("sliders").children) {
          const sl = sliders.find(x => x.id === row.dataset.id);
          if (!sl) continue;
          row.querySelector(".sl-l").textContent = typeof sl.label === "function" ? sl.label() : sl.label;
          const input = row.querySelector("input");
          if (sh.activeElement !== input && input.value !== String(sl.get())) input.value = String(sl.get());
        }
        for (const el of sh.getElementById("btns").children) {
          const b = buttons.find(x => x.id === el.dataset.id);
          if (b && typeof b.label === "function") el.textContent = b.label();
        }
        sh.getElementById("log").textContent = logBuf.slice(-CFG.logPanelLines).map(x => x.line).join("\n");
      });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

    // always-visible round button next to the pill (model { on, title }); handler runs on click
    function setQuick(model, handler) { if (handler) onQuick = handler; set("quick", model); }
    return { set, mount, render, addButton, addSlider, toggle, showManual, setStrip, setQuick, get open() { return open; } };
  })();

  async function copyWithFeedback(btn, text, okLabel) {
    const ok = await copyText(text);
    if (ok) {
      const old = btn.textContent; btn.textContent = okLabel || "Skopiowano \u2713";
      setTimeout(() => { btn.textContent = old; ui.render(); }, 1500);
      log("Skopiowano do schowka (" + text.length + " znak\u00f3w)");
    } else {
      ui.showManual(text);
      log("Schowek zablokowany: zaznacz tekst w polu i skopiuj (Cmd+C)");
    }
  }

  // =====================================================================
  // Role: AutoDarts local page -> relay (fallback B)
  // =====================================================================
  function startRelay() {
    let ok = 0, lastErr = "", lastRaw = null, seq = 0;
    ui.addButton("raw", "Kopiuj surowy stan", btn => copyWithFeedback(btn, safeJson(lastRaw, true)));
    ui.addButton("copylog", "Kopiuj log", btn => copyWithFeedback(btn, logBuf.map(x => x.line).join("\n")));
    ui.addButton("close", "Zwi\u0144", () => ui.toggle(false));
    let panelOpenPref = false;
    gget(K.panelOpen, false).then(v => { panelOpenPref = v; });

    (async function loop() {
      for (;;) {
        try {
          const r = await fetch("/api/state", { cache: "no-store" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          lastRaw = await r.json();
          await gset(K.relay, { ts: now(), seq: ++seq, origin: location.origin, raw: lastRaw });
          if (!ok) { ui.mount(panelOpenPref); log("Przeka\u017anik: /api/state dzia\u0142a na " + location.origin); }
          ok = now(); lastErr = "";
          const st = Core.normalizeState(lastRaw);
          ui.set("dot", "#22c55e");
          ui.set("pill", "AD2DC przeka\u017anik \u2713");
          ui.set("rows", [["/api/state", "OK " + location.origin], ["stan", st ? (st.status || "-") + " / lotek: " + st.count : "-"],
            ["lotki", st && st.count ? st.darts.map(d => d.label).join(" ") : "-"]]);
          ui.set("hint", "Ta karta jest tylko zapasowa. Wynik wpisuje karta DartCounter.");
          ui.set("err", "");
        } catch (e) {
          const m = errText(e);
          if (m !== lastErr) log("Przeka\u017anik: brak /api/state na " + location.origin + ": " + m);
          lastErr = m; ok = 0;
          ui.set("dot", "#9ca3af");
          ui.set("pill", "AD2DC (brak /api/state)");
          ui.set("rows", [["/api/state", "brak na " + location.origin]]);
          ui.set("err", "");
        }
        await sleep(ok ? 500 : 3000);
      }
    })();
  }

  // =====================================================================
  // Role: play.autodarts game tab -> publish finished turns (source "gra")
  // =====================================================================
  // runs code in the page JS world; at document-start <html> may not exist yet: then right when it appears
  function injectPage(code, what) {
    const go = () => {
      try {
        const sc = document.createElement("script");
        sc.textContent = code;
        (document.head || document.documentElement).appendChild(sc);
        sc.remove();
      } catch (e) { log(what + " nie wstrzykni\u0119ty: " + errText(e)); }
    };
    if (document.documentElement) { go(); return; }
    const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); go(); } });
    mo.observe(document, { childList: true });
  }

  // a message from this page (page script / helper). Not ev.source === window: Tampermonkey gives the userscript a
  // proxy as `window`, so that test never matched there and the helper's answers were dropped (3.5.1-3.5.3 reset).
  function samePage(ev) { return ev.origin === location.origin || ev.origin === "" || ev.origin === "null"; }

  function startPlay() {
    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const st = { frames: 0, via: {}, last: null, lastTs: 0, lastRaw: null, published: 0, lastVisit: null, hookErr: "" };
    const tracker = Core.createMatchTracker(publishVisit, msg => log(msg));

    ui.addButton("raw", "Kopiuj surowy stan", btn => copyWithFeedback(btn, safeJson(st.lastRaw, true)));
    ui.addButton("copylog", "Kopiuj log", btn => copyWithFeedback(btn, "AD2DC " + VERSION + " (karta gry) " + location.href + "\n" + logBuf.map(x => x.line).join("\n")));
    ui.addButton("close", "Zwi\u0144", () => ui.toggle(false));

    function onFrame(text, via) {
      let m; try { m = JSON.parse(text); } catch (_) { return; }
      if (!m || typeof m !== "object" || !m.data || typeof m.data !== "object") return;
      if (m.channel === "autodarts.boards") { gset(K.cloud, { ts: now(), raw: m.data }); return; } // board state for the local fallback
      if (m.channel !== "autodarts.matches") return;
      const match = Core.parseMatch(m.data);
      if (!match) return;
      st.frames++; st.via[via] = (st.via[via] || 0) + 1;
      if (st.frames === 1) log("Odbieram stan meczu z gry Autodarts (" + via + ")");
      const prevRaw = st.lastRaw;
      st.last = match; st.lastTs = now(); st.lastRaw = m.data;
      if (atcBullFrame(prevRaw, m.data, match)) { refresh(); return; } // Around the Clock: 25 on the bull is being corrected
      // the same match after a reset (page reloaded): keep the visit ids of the restarted leg
      if (st.epochSaved && st.epochSaved.matchId === match.matchId && !tracker.epoch() && !tracker.current()) tracker.reset(st.epochSaved.epoch);
      tracker.update(match);
      gset(K.playLive, { ts: now(), matchId: match.matchId, key: match.key, round: match.round, player: match.playerName, variant: match.variant,
        throws: match.darts.map(d => d.raw), finished: match.finished });
      if (match.finished && /x01/i.test(match.variant)) autoNextLeg(m.data);
      refresh();
    }

    // ----- Around the Clock: 25 on the bull target = miss in Autodarts (like DartCounter "Finish by hitting the bullseye") -----
    // Autodarts has no such setting (bull target in mode Full takes 25 and 50). The script corrects the 25 to a miss
    // with the app's own throw correction (PATCH throws, coordinates outside the board). Until Autodarts answers, the
    // state with the 25 is held back (no visit, no sound). Not accepted within 4 s -> the held state goes on as usual
    // (the visit ends the Autodarts game, DartCounter takes 25 as a miss and the game tab starts Autodarts again).
    function atcFixWanted() {
      const c = st.atcDc; // DartCounter ATC bull setting, published by the DartCounter tab
      return !c || c.throwout === "bullseye";
    }
    function atcBullFrame(prevRaw, raw, match) {
      const f = st.atcFix;
      if (f) {
        if (raw.id !== f.matchId) { st.atcFix = null; return false; }
        const d = match.darts[f.idx];
        if (!(d && d.number === 25 && d.multiplier === 1)) {
          st.atcFix = null;
          log("ATC: Autodarts przyj\u0105\u0142 korekt\u0119, lotka " + (f.idx + 1) + " = " + (d ? d.label : "brak") + (match.finished ? "" : ", gra trwa dalej (bull tylko 50)"));
          return false;
        }
        f.held = { raw, match };
        return true;
      }
      const idx = Core.atcOuterBullThrow(prevRaw, raw);
      if (idx < 0 || !atcFixWanted()) return false;
      st.atcFix = { matchId: raw.id, idx, ts: now(), held: { raw, match } };
      const t = match.darts[idx] && match.darts[idx].raw;
      const c = t && t.coords && typeof t.coords.x === "number" && typeof t.coords.y === "number" && (t.coords.x || t.coords.y) ? t.coords : { x: 0, y: -1 };
      const len = Math.hypot(c.x, c.y) || 1;
      const coords = { x: c.x / len * 1.5, y: c.y / len * 1.5 }; // same direction, outside the board = miss
      log("ATC: 25 na bullu (lotka " + (idx + 1) + ") \u2192 poprawiam w Autodarts na pud\u0142o, bull liczy si\u0119 tylko 50");
      const fix = st.atcFix;
      api("PATCH", "/matches/" + raw.id + "/throws", { changes: { [String(idx)]: { coords, type: "Normal" } } }).then(r => {
        log("ATC API: PATCH /matches/" + raw.id + "/throws \u2192 " + (r.ok ? "OK " + r.status : (r.err || "b\u0142\u0105d " + r.status)));
        if (!r.ok) releaseAtcFix(fix, "Autodarts odrzuci\u0142 korekt\u0119 (" + (r.err || r.status) + ")");
      });
      setTimeout(() => releaseAtcFix(fix, "brak poprawionego stanu po 4 s"), 4000);
      return true;
    }
    function releaseAtcFix(fix, why) {
      if (st.atcFix !== fix) return;
      st.atcFix = null;
      log("ATC: 25 zostaje w Autodarts (" + why + "). DartCounter i tak liczy 25 jako pud\u0142o; gdy Autodarts zako\u0144czy gr\u0119, karta gry zacznie j\u0105 od nowa.");
      const h = fix.held;
      tracker.update(h.match);
      gset(K.playLive, { ts: now(), matchId: h.match.matchId, key: h.match.key, round: h.match.round, player: h.match.playerName, variant: h.match.variant,
        throws: h.match.darts.map(d => d.raw), finished: h.match.finished });
      refresh();
    }

    async function publishVisit(v) {
      const item = { id: v.id, ts: now(), reason: v.reason, throws: v.darts.map(d => d.raw), labels: v.darts.map(d => d.label).join(" "),
        busted: v.busted, points: v.points, variant: v.variant || "", settings: v.settings || null, finished: !!v.finished };
      const list = (await gget(K.playVisits, [])) || [];
      if (!list.some(x => x.id === item.id)) list.push(item);
      while (list.length > 20) list.shift();
      await gset(K.playVisits, list);
      st.published++; st.lastVisit = item;
      log("Tura do DartCounter: " + item.labels + " = " + v.darts.reduce((a, d) => a + d.score, 0) + " (" + v.reason + ", tura " + v.key + ")");
      refresh();
    }

    // 1) wrap the page WebSocket through unsafeWindow (works when the script sees the page JS world)
    try {
      const Native = W.WebSocket;
      if (Native && !Native.__ad2dc) {
        const Wrapped = function (url, protocols) {
          const ws = protocols !== undefined ? new Native(url, protocols) : new Native(url);
          try {
            if (/autodarts/.test(String(url))) {
              log("Pods\u0142uch WebSocket: " + String(url).split("?")[0]);
              ws.addEventListener("message", ev => { if (typeof ev.data === "string") onFrame(ev.data, "unsafeWindow"); });
            }
          } catch (e) { log("B\u0141\u0104D pods\u0142uchu: " + errText(e)); }
          return ws;
        };
        Wrapped.prototype = Native.prototype;
        ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => { Wrapped[k] = Native[k]; });
        Wrapped.__ad2dc = true;
        W.WebSocket = Wrapped;
      }
    } catch (e) { st.hookErr = errText(e); log("Pods\u0142uch przez unsafeWindow nie dzia\u0142a: " + st.hookErr); }

    // 2) same hook as a page script (in case unsafeWindow is not the page world); frames come back via postMessage
    window.addEventListener("message", ev => {
      const d = ev.data;
      // same page (origin), not "ev.source === window": in a userscript sandbox `window` is a proxy, never equal to ev.source
      if (samePage(ev) && d && d.__ad2dc === 1 && typeof d.data === "string") onFrame(d.data, "skrypt strony");
    });
    try {
      const code = "(" + function () {
        var N = window.WebSocket;
        if (!N || N.__ad2dc) return;
        var Wr = function (u, p) {
          var ws = p !== undefined ? new N(u, p) : new N(u);
          try {
            if (/autodarts/.test(String(u))) ws.addEventListener("message", function (e) { if (typeof e.data === "string") window.postMessage({ __ad2dc: 1, data: e.data }, "*"); });
          } catch (_) {}
          return ws;
        };
        Wr.prototype = N.prototype;
        ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { Wr[k] = N[k]; });
        Wr.__ad2dc = true;
        window.WebSocket = Wr;
      } + ")();";
      injectPage(code, "Skrypt strony");
    } catch (e) { log("Skrypt strony nie wstrzykni\u0119ty: " + errText(e)); }

    // ----- AutoDarts reset, ordered by the DartCounter tab when a DartCounter leg ends -----
    // Page helper (page JS world): API calls with the app's own login. Token: the app's auth module
    // (refreshes it when needed), else the bearer token seen in the app's own requests. Only /matches/ and /lobbies/ paths.
    try {
      const helper = "(" + function () {
        if (window.__ad2dcHelper) return;
        window.__ad2dcHelper = 1;
        var seen = { token: "", base: "" }, auth = null;
        try {
          var oOpen = XMLHttpRequest.prototype.open, oSet = XMLHttpRequest.prototype.setRequestHeader;
          XMLHttpRequest.prototype.open = function (m, u) { try { this.__ad2dcUrl = String(u); } catch (_) {} return oOpen.apply(this, arguments); };
          XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
            try {
              var u = this.__ad2dcUrl || "";
              if (/^authorization$/i.test(k) && /^Bearer /.test(String(v)) && /api\.autodarts\./.test(u)) {
                seen.token = String(v).slice(7);
                var mm = /^(https:\/\/api\.autodarts\.[a-z]+\/gs\/v0)\//.exec(u);
                if (mm) seen.base = mm[1];
              }
            } catch (_) {}
            return oSet.apply(this, arguments);
          };
        } catch (_) {}
        function findAuth() {
          if (auth) return Promise.resolve(auth);
          var urls = [].slice.call(document.querySelectorAll('link[rel=modulepreload][href*="/assets/src-"],script[type=module][src*="/assets/src-"]'))
            .map(function (e) { return e.href || e.src; });
          var i = 0;
          function next() {
            if (i >= urls.length) return null;
            return import(urls[i++]).then(function (mod) {
              for (var k in mod) { var v = mod[k]; if (v && typeof v.getToken === "function" && typeof v.refreshToken === "function") { auth = v; return v; } }
              return next();
            }, next);
          }
          return Promise.resolve().then(next);
        }
        function token() {
          return findAuth().then(function (a) {
            if (!a) return seen.token;
            return Promise.resolve(a.refreshToken()).then(function () { return a.getToken() || seen.token; }, function () { return a.getToken() || seen.token; });
          }, function () { return seen.token; });
        }
        window.addEventListener("message", function (ev) {
          var d = ev.data;
          if (ev.origin !== location.origin || !d || d.__ad2dcCmd !== 1) return;
          function reply(x) { x.__ad2dcRes = 1; x.rid = d.rid; window.postMessage(x, "*"); }
          var patch = d.method === "PATCH" && /^\/matches\/[\w\-]+\/throws$/.test(String(d.path)); // only a throw correction
          if (!(patch || /^(GET|POST|DELETE)$/.test(d.method)) || !/^\/(matches|lobbies)\/[\w\-\/]+$/.test(String(d.path))) return reply({ ok: false, status: 0, err: "niedozwolone: " + d.method + " " + d.path });
          token().then(function (t) {
            if (!t) return reply({ ok: false, status: 0, err: "brak tokenu logowania Autodarts (od\u015bwie\u017c kart\u0119 gry)" });
            var init = { method: d.method, headers: { Authorization: "Bearer " + t } };
            if (patch && d.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(d.body); }
            return fetch((seen.base || "https://api.autodarts.com/gs/v0") + d.path, init)
              .then(function (r) {
                return r.text().then(function (txt) {
                  var j = null;
                  try { j = txt ? JSON.parse(txt) : null; } catch (_) {}
                  reply({ ok: r.ok, status: r.status, data: j, err: r.ok ? "" : "HTTP " + r.status + (txt ? " " + txt.slice(0, 160) : "") });
                });
              });
          }).catch(function (e) { reply({ ok: false, status: 0, err: String(e && e.message || e) }); });
        });
      } + ")();";
      injectPage(helper, "Pomocnik strony");
    } catch (e) { log("Pomocnik strony nie wstrzykni\u0119ty: " + errText(e)); }

    const pending = new Map();
    window.addEventListener("message", ev => {
      const d = ev.data;
      if (!samePage(ev) || !d || d.__ad2dcRes !== 1 || !pending.has(d.rid)) return; // answer of the page helper (see samePage)
      const fn = pending.get(d.rid); pending.delete(d.rid); fn(d);
    });
    function api(method, path, body) {
      return new Promise(resolve => {
        const rid = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => { pending.delete(rid); resolve({ ok: false, status: 0, err: "strona nie odpowiedzia\u0142a (10 s)" }); }, 10000);
        pending.set(rid, d => { clearTimeout(timer); resolve(d); });
        window.postMessage({ __ad2dcCmd: 1, rid, method, path, body }, "*");
      });
    }
    async function waitFresh(matchId, ms) {
      const end = now() + ms;
      while (now() < end) {
        if (st.lastRaw && st.lastRaw.id === matchId && Core.isFreshLeg(st.lastRaw)) return true;
        await sleep(150);
      }
      return false;
    }
    function newEpoch(matchId) {
      const e = now().toString(36);
      tracker.reset(e);
      gset(K.playEpoch, { matchId, epoch: e });
      return e;
    }
    function stateText(raw) {
      if (!raw) return "brak stanu meczu";
      const t = st.last;
      return "mecz " + raw.id + ", leg " + raw.leg + ", runda " + raw.round + ", wyniki " + safeJson(raw.gameScores) + ", start " + (raw.settings && raw.settings.baseScore) +
        ", legi/sety " + (raw.legs || 0) + "/" + (raw.sets || 0) + (raw.finished ? ", MECZ SKO\u0143CZONY" : "") + (raw.gameFinished ? ", LEG SKO\u0143CZONY" : "") +
        (t && t.darts.length ? ", lotki tury: " + t.darts.map(d => d.label).join(" ") : "");
    }
    // every API step goes into the log (status or error): "Kopiuj log" on the game tab shows what Autodarts answered
    async function call(method, path) {
      const r = await api(method, path);
      log("Reset API: " + method + " " + path + " \u2192 " + (r.ok ? "OK " + r.status : (r.err || "b\u0142\u0105d " + r.status)));
      return r;
    }
    async function waitFinished(matchId, ms) {
      const end = now() + ms;
      while (now() < end) {
        if (st.lastRaw && st.lastRaw.id === matchId && st.lastRaw.finished) return true;
        await sleep(150);
      }
      return false;
    }
    // new match with the same settings and players (what "Play again" does). running: the old match is not finished:
    // end it first (DELETE when the lobby could be made from it, else "Leave match" = surrender, like the app's buttons)
    async function newMatch(matchId, running) {
      let lob = await call("POST", "/lobbies/from-match/" + matchId);
      let ended = "";
      if (running) {
        if (lob.ok && lob.data && lob.data.id) {
          const del = await call("DELETE", "/matches/" + matchId);
          if (del.ok) ended = "poprzedni przerwany";
          else { await call("DELETE", "/lobbies/" + lob.data.id); lob = null; }
        }
        if (!ended) {
          const sur = await call("POST", "/matches/" + matchId + "/surrender");
          if (!sur.ok) return { ok: false, how: "nie mog\u0119 zako\u0144czy\u0107 meczu w Autodarts (" + (sur.err || sur.status) + ")" };
          ended = "poprzedni opuszczony";
          log("Reset: mecz opuszczony, " + (await waitFinished(matchId, 4000) ? "Autodarts poda\u0142 koniec meczu" : "brak ko\u0144ca meczu w stanie (pr\u00f3buj\u0119 dalej)"));
          lob = await call("POST", "/lobbies/from-match/" + matchId);
        }
      }
      if (!lob || !lob.ok || !lob.data || !lob.data.id) {
        return { ok: false, how: "nowy mecz: lobby nie powsta\u0142o (" + ((lob && lob.err) || "brak id") + ")" + (ended ? ". Mecz w Autodarts jest ju\u017c zako\u0144czony: za\u0142\u00f3\u017c now\u0105 gr\u0119 X01 r\u0119cznie" : "") };
      }
      const start = await call("POST", "/lobbies/" + lob.data.id + "/start");
      if (!start.ok || !start.data || !start.data.id) {
        return { ok: false, how: "nowy mecz nie wystartowa\u0142 (" + (start.err || "brak id") + ")" + (ended ? ". Poprzedni mecz jest ju\u017c zako\u0144czony: za\u0142\u00f3\u017c now\u0105 gr\u0119 X01 r\u0119cznie" : "") };
      }
      st.navigating = true;
      log("Reset: nowy mecz X01 " + start.data.id + ", przechodz\u0119 do niego");
      setTimeout(() => location.assign("/matches/" + start.data.id), 300);
      return { ok: true, how: "nowy mecz X01" + (ended ? " (" + ended + ")" : "") };
    }
    // Around the Clock: the Autodarts game is over (e.g. finished on 25), DartCounter still plays: next game / new match
    async function resetAtc(cmd) {
      if (!/atc|around/i.test(st.last.variant)) return { ok: false, how: "w Autodarts nie jest Around the Clock (" + (st.last.variant || "?") + ")" };
      const raw = st.lastRaw, matchId = raw.id;
      if (!raw.finished && !raw.gameFinished) return { ok: true, how: "Autodarts ATC gra dalej, nic nie zmieniam" };
      const plan = Core.resetPlan(raw);
      log("Reset ATC: plan " + (plan === "next" ? "nast\u0119pna gra (games/next)" : "nowy mecz"));
      newEpoch(matchId);
      if (plan === "next") {
        const r = await call("POST", "/matches/" + matchId + "/games/next");
        if (r.ok && await waitFresh(matchId, 6000)) return { ok: true, how: "ATC: nast\u0119pna gra w Autodarts (games/next)" };
        log("Reset ATC: games/next " + (r.ok ? "bez nowej gry w stanie meczu (" + stateText(st.lastRaw) + ")" : "nie wyszed\u0142") + ", zak\u0142adam nowy mecz");
        if (!r.ok && (r.status === 401 || /token/i.test(r.err))) return { ok: false, how: r.err };
      }
      const nm = await newMatch(matchId, false);
      return nm.ok ? { ok: true, how: "ATC: " + nm.how } : nm;
    }
    async function doReset(cmd) {
      log("Reset: polecenie " + cmd.id + " (" + (cmd.kind === "atc" ? "Around the Clock" : cmd.kind === "match" ? "koniec meczu" : "koniec lega") + " w DartCounter, " + (cmd.won ? "wygrany" : "przegrany") + ") | " + location.pathname + " | " + stateText(st.lastRaw));
      if (!/\/matches\//.test(location.pathname) || !st.last || !st.lastRaw) return { ok: false, how: "karta gry nie ma otwartego meczu (" + location.pathname + ", stan: " + (st.frames ? "jest" : "brak") + ")" };
      if (cmd.kind === "atc") return resetAtc(cmd);
      if (!/x01/i.test(st.last.variant)) return { ok: false, how: "w Autodarts nie jest X01 (" + (st.last.variant || "?") + ")" };
      // darts of a turn in progress are never thrown away: that turn goes to DartCounter first
      const end = now() + 90000;
      let waited = false;
      while (st.last.darts.length && !st.last.finished) {
        if (now() > end) return { ok: false, how: "w Autodarts trwa tura z lotkami (" + st.last.darts.map(d => d.label).join(" ") + "), nie resetuj\u0119" };
        if (!waited) {
          waited = true;
          gset(K.resetAck, { id: cmd.id, ts: now(), state: "busy", how: "czekam na koniec tury w toku (" + st.last.darts.map(d => d.label).join(" ") + ")", tab: st.resetTab });
          log("Reset: czekam, a\u017c tura w toku p\u00f3jdzie do DartCounter (" + st.last.darts.map(d => d.label).join(" ") + ")");
        }
        await sleep(300);
      }
      const raw = st.lastRaw, matchId = raw.id;
      if (Core.isFreshLeg(raw)) return { ok: true, how: "Autodarts ju\u017c jest na starcie lega" };
      const plan = Core.resetPlan(raw);
      log("Reset: plan " + (plan === "next" ? "nast\u0119pny leg" : plan === "again" ? "nowy mecz" : "leg od nowa") + (waited ? " (uwaga: tura w toku posz\u0142a ju\u017c do DartCounter)" : ""));
      if (plan === "again") { newEpoch(matchId); return newMatch(matchId, false); }
      const path = plan === "next" ? "/games/next" : "/games/restart";
      newEpoch(matchId);
      const r = await call("POST", "/matches/" + matchId + path);
      if (r.ok && await waitFresh(matchId, 6000)) return { ok: true, how: plan === "next" ? "nast\u0119pny leg (games/next)" : "leg od nowa (games/restart)" };
      log("Reset: " + path + (r.ok ? " bez \u015bwie\u017cego lega w stanie meczu (" + stateText(st.lastRaw) + ")" : " nie wyszed\u0142") + ", zak\u0142adam nowy mecz");
      if (!r.ok && (r.status === 401 || /token/i.test(r.err))) return { ok: false, how: r.err };
      if (st.lastRaw && st.lastRaw.id === matchId && Core.isFreshLeg(st.lastRaw)) return { ok: true, how: "leg od nowa (" + path + ", p\u00f3\u017aniej)" };
      return newMatch(matchId, !(st.lastRaw && st.lastRaw.finished));
    }
    // X01: a won leg in Autodarts (leg / match finished by the checkout) -> next leg by itself, like its Next button.
    // The visit with the checkout is already on its way to DartCounter. Off only with "Reset Autodarts: wy\u0142\u0105czony".
    const autoDone = new Set();
    function autoNextLeg(raw) {
      const key = raw.id + "/" + raw.set + "." + raw.leg;
      // won by a checkout only (somebody at 0), never the end of a match the script itself left or aborted
      if (autoDone.has(key) || st.navigating || !Array.isArray(raw.gameScores) || !raw.gameScores.some(x => x === 0)) return;
      autoDone.add(key);
      setTimeout(async () => {
        const cur = st.lastRaw;
        if (st.navigating) return;
        if (!cur || cur.id !== raw.id || !(cur.finished || cur.gameFinished)) { log("Autodarts: leg ju\u017c przeszed\u0142 dalej (" + stateText(cur) + ")"); return; }
        if ((st.resetMode || "leg") === "off") { log("Autodarts: wygrany leg, bez przej\u015bcia dalej (Reset Autodarts: wy\u0142\u0105czony)"); return; }
        if (resetBusy) { log("Autodarts: wygrany leg, przej\u015bcie dalej robi ju\u017c reset z DartCounter"); return; }
        resetBusy = true;
        let r;
        try {
          const plan = Core.resetPlan(cur);
          log("Autodarts: wygrany leg (" + stateText(cur) + ") \u2192 " + (plan === "again" ? "nowy mecz (mecz w Autodarts sko\u0144czony)" : "nast\u0119pny leg"));
          newEpoch(cur.id);
          if (plan === "again") r = await newMatch(cur.id, false);
          else {
            const a = await call("POST", "/matches/" + cur.id + "/games/next");
            r = a.ok && await waitFresh(cur.id, 6000) ? { ok: true, how: "nast\u0119pny leg (games/next)" }
              : { ok: false, how: a.ok ? "brak nowego lega w stanie meczu (" + stateText(st.lastRaw) + ")" : a.err };
          }
        } catch (e) { r = { ok: false, how: errText(e) }; }
        resetBusy = false;
        log("Autodarts po wygranym legu: " + (r.ok ? "\u2713 " : "NIE WYSZ\u0141O: ") + r.how);
        gset(K.autoNext, { ts: now(), ok: r.ok, how: r.how });
      }, 2500);
    }
    let resetBusy = false;
    async function checkReset() {
      if (resetBusy) return;
      const cmd = await gget(K.resetCmd, null);
      if (!cmd || cmd.id === st.resetSeen) return;
      st.resetSeen = cmd.id;
      if (now() - cmd.ts > 60000) { log("Reset: pomijam stare polecenie " + cmd.id + " (" + Math.round((now() - cmd.ts) / 1000) + " s)"); return; }
      const tab = Math.random().toString(36).slice(2, 8);
      const prev = await gget(K.resetAck, null);
      if (prev && prev.id === cmd.id) { log("Reset: polecenie " + cmd.id + " wykonuje inna karta gry"); return; }
      st.resetTab = tab;
      await gset(K.resetAck, { id: cmd.id, ts: now(), state: "busy", how: "karta gry resetuje", tab });
      await sleep(200);
      const mine = await gget(K.resetAck, null);
      if (!mine || mine.tab !== tab) { log("Reset: polecenie " + cmd.id + " wykonuje inna karta gry"); return; }
      for (let i = 0; resetBusy && i < 100; i++) await sleep(150); // the auto next leg may be running: then this order sees a fresh leg
      resetBusy = true;
      let r;
      try { r = await doReset(cmd); } catch (e) { r = { ok: false, how: errText(e) }; }
      resetBusy = false;
      log("Reset Autodarts: " + (r.ok ? "\u2713 " : "NIE WYSZED\u0141: ") + r.how);
      await gset(K.resetAck, { id: cmd.id, ts: now(), state: r.ok ? "ok" : "fail", how: r.how, tab });
    }
    if (typeof GM_addValueChangeListener === "function") { try { GM_addValueChangeListener(K.resetCmd, () => { checkReset(); }); } catch (_) {} }
    gget(K.resetCmd, null).then(c => { if (c) st.resetSeen = c.id; }); // an old order is not for this page
    setTimeout(() => setInterval(checkReset, 500), 1500);
    gget(K.playEpoch, null).then(e => { st.epochSaved = e; });
    const readAtcDc = () => gget(K.atcDc, null).then(c => { st.atcDc = c; }).then(() => gget(K.resetMode, "leg")).then(m => { st.resetMode = m; });
    readAtcDc(); setInterval(readAtcDc, 2000);

    gget(K.panelOpen, false).then(v => ui.mount(v));
    log("Start " + VERSION + " na karcie gry " + location.pathname + " (" + managerName() + ")");
    setInterval(refresh, 1000);
    setInterval(() => gset(K.playHb, { ts: now(), frames: st.frames, path: location.pathname }), 1000);

    function refresh() {
      const m = st.last;
      const age = st.lastTs ? Math.round((now() - st.lastTs) / 1000) + " s temu" : "jeszcze nic";
      const onMatch = /\/matches\//.test(location.pathname);
      ui.set("rows", [
        ["Wersja", VERSION],
        ["Stan meczu", st.frames ? "OK (" + age + ", " + Object.keys(st.via).join(" + ") + ")" : "brak"],
        ["Mecz", m ? (m.variant || "?") + ", runda " + m.round + ", gracz " + (m.playerName || m.player) : "-"],
        ["Lotki teraz", m && m.darts.length ? m.darts.map(d => d.label).join(" ") + " = " + m.darts.reduce((a, d) => a + d.score, 0) : "-"],
        ["Wys\u0142ane tury", String(st.published) + (st.lastVisit ? " (ostatnia: " + st.lastVisit.labels + ")" : "")]
      ]);
      ui.set("hint", st.frames ? "Wynik idzie do DartCounter po zako\u0144czeniu tury (wyj\u0119cie lotek / nast\u0119pna tura)."
        : onMatch ? "Nie widz\u0119 stanu meczu. Od\u015bwie\u017c t\u0119 kart\u0119 (Cmd+R) i rzu\u0107 lotk\u0119." : "Otw\u00f3rz gr\u0119 X01 w Autodarts.");
      ui.set("err", m && m.variant && !/x01/i.test(m.variant) ? "To nie jest gra X01 (" + m.variant + ")." : "");
      ui.set("dot", st.frames ? "#22c55e" : onMatch ? "#ef4444" : "#f59e0b");
      ui.set("pill", "AD2DC " + VERSION + (st.frames ? " gra \u2713" + (st.published ? " " + st.published : "") : onMatch ? " brak stanu" : " gra"));
    }
  }

  // =====================================================================
  // Role: DartCounter -> poll /api/state, track visits, enter scores
  // =====================================================================
  function startDartCounter() {
    const tabId = Math.random().toString(36).slice(2, 10);
    const S = {
      enabled: true, apiBase: CFG.defaultApiBase, doubleOut: true, sendDelay: 0, source: "play", entryMode: "sum", sounds: true, soundVolume: 60,
      playSeen: null, playLive: null, playHb: null, listener: false,
      leader: false,
      apiOk: 0, apiErr: "", apiFails: 0, lastRaw: null, lastRawDarts: null,
      relayOk: 0, cloudOk: 0, sourceName: "-", snap: null,
      lastVisit: null, lastEntry: null, err: "", busy: false,
      queue: [], target: null, missed: [], waitWhy: "", dialogCtx: null, lastOwn: null,
      resetMode: "leg", reset: null, startScore: null, pendingEnd: null, lastLegEndTs: 0, endScreen: false, legSnap: null, interimSnap: null,
      rem: [], lastChangedIdx: null
    };

    const tracker = Core.createTracker(onVisit, msg => log(msg));
    // dart sounds: beside the bridge, never touches the queue or the entry
    // bull fireworks + short fireworks sound; on/off with the speaker button (sounds and effects together)
    function bullFireworks(kind, label, force) {
      if (!S.sounds && !force) return;
      setTimeout(() => {
        Fireworks.burst(kind);
        const ok = S.sounds && Sound.play("fireworks", (S.soundVolume / 100) * (kind === "big" ? 1 : 0.7));
        log("Fajerwerki: " + label + " (" + (kind === "big" ? "du\u017ce" : "ma\u0142e") + ")" + (S.sounds ? (ok ? ", z d\u017awi\u0119kiem" : ", d\u017awi\u0119k: " + Sound.state) : ""));
      }, 0);
    }
    const bullDarts = Core.createNewDarts(d => {
      const kind = Core.bullKind(d);
      if (kind === "big" && S.leader) bullFireworks(kind, d.label); // 3.4.1: bullseye (50) only, nothing for 25
    });
    const soundRules = Core.createSoundRules((name, why) => {
      if (!S.sounds || !S.leader) return;
      setTimeout(() => {
        const ok = Sound.play(name, S.soundVolume / 100);
        log("D\u017awi\u0119k: " + name + " (" + why + ")" + (ok ? "" : ", nie zagra\u0142: " + Sound.state));
      }, 0);
    });

    // ----- buttons -----
    ui.addButton("toggle", () => (S.enabled ? "Wy\u0142\u0105cz most" : "W\u0142\u0105cz most"), async () => {
      S.enabled = !S.enabled; await gset(K.enabled, S.enabled);
      if (!S.enabled) S.queue.length = 0;
      tracker.reset();
      log("Most " + (S.enabled ? "W\u0141\u0104CZONY" : "WY\u0141\u0104CZONY"));
    });
    ui.addButton("source", () => "\u0179r\u00f3d\u0142o: " + (S.source === "play" ? "gra Autodarts" : "lokalne /api/state"), async () => {
      S.source = S.source === "play" ? "local" : "play";
      await gset(K.source, S.source);
      tracker.reset();
      // turns the game tab published before the switch were not for this source: never enter them
      if (S.source === "play") ((await gget(K.playVisits, [])) || []).forEach(x => S.playSeen.add(x.id));
      log("\u0179r\u00f3d\u0142o lotek: " + (S.source === "play" ? "gra X01 na play.autodarts (karta gry)" : "lokalne /api/state (127.0.0.1)"));
    });
    ui.addButton("copylog", "Kopiuj log", btn => copyWithFeedback(btn, buildReport()));
    ui.addButton("raw", "Kopiuj surowy stan", btn => copyWithFeedback(btn,
      "/api/state teraz:\n" + safeJson(S.lastRaw, true) + "\n\nostatni stan z lotkami:\n" + safeJson(S.lastRawDarts, true)));
    ui.addButton("api", "Adres API", async () => {
      const v = prompt("Adres Autodarts (bez /api/state):", S.apiBase);
      if (v && /^https?:\/\/[^/]+$/i.test(v.trim())) { S.apiBase = v.trim(); await gset(K.apiBase, S.apiBase); log("Nowy adres API: " + S.apiBase); }
      else if (v) log("Z\u0142y adres: " + v + " (przyk\u0142ad: http://127.0.0.1:3180)");
    });
    ui.addButton("dbl", () => "Double out: " + (S.doubleOut ? "TAK" : "NIE"), async () => {
      S.doubleOut = !S.doubleOut; await gset(K.doubleOut, S.doubleOut); log("Double out: " + (S.doubleOut ? "TAK" : "NIE"));
    });
    ui.addButton("entry", () => "Wpis: " + (S.entryMode === "darts" ? "lotka po lotce" : "suma tury"), async () => {
      S.entryMode = S.entryMode === "darts" ? "sum" : "darts";
      await gset(K.entryMode, S.entryMode);
      log("Spos\u00f3b wpisu: " + (S.entryMode === "darts" ? "lotka po lotce (klawiatura \u201esingle\u201d w DartCounter)" : "suma tury"));
    });
    // speaker button next to the AD2DC pill: one click = sounds on/off, saved with GM_setValue; the click also unlocks audio
    function soundQuick() {
      return { on: S.sounds, title: S.sounds ? "D\u017awi\u0119ki i efekty: W\u0141 (kliknij, \u017ceby wy\u0142\u0105czy\u0107)" : "D\u017awi\u0119ki i efekty: WY\u0141 (kliknij, \u017ceby w\u0142\u0105czy\u0107)" };
    }
    async function toggleSounds() {
      S.sounds = !S.sounds;
      Sound.unlock(); // real click: allowed to start audio
      if (!S.sounds) { Sound.stop(); Fireworks.remove(); }
      ui.setQuick(soundQuick());
      await gset(K.sounds, S.sounds);
      log("D\u017awi\u0119ki i efekty (fajerwerki): " + (S.sounds ? "W\u0141\u0104CZONE" : "WY\u0141\u0104CZONE"));
    }
    ui.addButton("fwtest", "Test fajerwerk\u00f3w", () => {
      Sound.unlock();
      setTimeout(() => bullFireworks("big", "test", true), Sound.ready ? 0 : 800);
    });
    ui.addButton("soundtest", "Test d\u017awi\u0119ku", () => {
      Sound.unlock();
      setTimeout(() => { if (!Sound.play("cheer", S.soundVolume / 100)) log("Test d\u017awi\u0119ku: " + Sound.state); }, Sound.ready ? 0 : 800);
    });
    ui.addSlider("vol", () => "G\u0142o\u015bno\u015b\u0107: " + S.soundVolume + "%", () => S.soundVolume, v => {
      S.soundVolume = v;
      clearTimeout(S.volSave); S.volSave = setTimeout(() => gset(K.soundVolume, S.soundVolume), 300);
    });
    ui.addButton("reset", () => "Reset Autodarts: " + RESET_MODES[S.resetMode], async () => {
      const order = Object.keys(RESET_MODES);
      S.resetMode = order[(order.indexOf(S.resetMode) + 1) % order.length];
      await gset(K.resetMode, S.resetMode);
      log("Reset gry X01 w Autodarts: " + RESET_MODES[S.resetMode]);
    });
    ui.addButton("missed", () => "Wyczy\u015b\u0107 niewpisane (" + S.missed.length + ")", () => {
      if (!S.missed.length) return;
      log("Wyczyszczono list\u0119 niewpisanych tur (" + S.missed.map(m => m.labels).join(", ") + ")");
      S.missed.length = 0; S.err = "";
    });
    ui.addButton("delay", () => "Op\u00f3\u017anienie: " + S.sendDelay + " s", async () => {
      const steps = [0, 3, 5, 10];
      S.sendDelay = steps[(steps.indexOf(S.sendDelay) + 1) % steps.length];
      await gset(K.sendDelay, S.sendDelay);
      log("Op\u00f3\u017anienie wysy\u0142ki po wyj\u0119ciu lotek: " + S.sendDelay + " s");
    });
    ui.addButton("close", "Zwi\u0144", () => ui.toggle(false));

    // ----- boot -----
    (async () => {
      S.enabled = await gget(K.enabled, true);
      S.apiBase = await gget(K.apiBase, CFG.defaultApiBase);
      S.doubleOut = await gget(K.doubleOut, true);
      S.sendDelay = Number(await gget(K.sendDelay, 0)) || 0;
      S.entryMode = (await gget(K.entryMode, "sum")) === "darts" ? "darts" : "sum";
      { const m = await gget(K.resetMode, "leg"); S.resetMode = RESET_MODES[m] ? m : "leg"; }
      S.sounds = (await gget(K.sounds, true)) !== false;
      ui.setQuick(soundQuick(), () => { toggleSounds(); });
      { const v = Number(await gget(K.soundVolume, 60)); S.soundVolume = isFinite(v) ? Math.max(0, Math.min(100, v)) : 60; }
      // autoplay rules: audio starts only after a real user gesture on this page
      const unlockOnGesture = ev => { if (ev.isTrusted && S.sounds) Sound.unlock(); };
      for (const ev of ["pointerdown", "mousedown", "click", "keydown", "touchend"]) window.addEventListener(ev, unlockOnGesture, true);
      S.source = (await gget(K.source, "play")) === "local" ? "local" : "play";
      S.playSeen = new Set(((await gget(K.playVisits, [])) || []).map(x => x.id)); // visits from before this page load are not entered
      ui.mount(await gget(K.panelOpen, false));
      log("Start " + VERSION + " na " + location.pathname + " (" + managerName() + ", GM_*: " + hasGM_ + ", GM.*: " + hasGMdot + ")");
      leaderLoop();
      pollLoop();
      playLoop();
      queueLoop();
      setInterval(watchRemaining, 400);
      setInterval(refreshPanel, 500);
    })();

    // ----- page helpers -----
    function atcPage() { return /^\/game\/around-the-clock\b/.test(location.pathname); }
    function matchPage() {
      if (atcPage()) return { ok: true, atc: true, text: "TAK (Around the Clock)" };
      const p = location.pathname;
      if (/^\/game\/match\b/.test(p)) return { ok: true, text: "TAK (mecz X01 lokalny)" };
      if (/^\/(online-game|local-tournament-game)\/match\b/.test(p)) return { ok: true, text: "TAK (mecz X01 online/turniej)" };
      if (/^\/game\//.test(p)) return { ok: false, text: "NIE (to inna gra ni\u017c X01: " + p + ")" };
      return { ok: false, text: "NIE (" + p + ")" };
    }
    function visible(el) {
      if (!el || !el.isConnected) return false;
      if (el.getClientRects().length === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    }
    function readRemaining() {
      return Array.from(document.querySelectorAll("app-remaining-score")).filter(visible).map(el => {
        const m = (el.textContent || "").match(/\d+/);
        return m ? parseInt(m[0], 10) : null;
      });
    }
    function dialogOpen() {
      return Array.from(document.querySelectorAll("app-darts-for-throwout-dialog")).some(visible);
    }
    // Answers the DartCounter dialog with the darts of our visit. Sections (DartCounter order):
    // "Darts used on a double" (0..3) and "Darts used for checkout" (1..3, only on a checkout).
    async function answerDartsDialog(v, rest) {
      const dlg = Array.from(document.querySelectorAll("app-darts-for-throwout-dialog")).find(visible);
      if (!dlg) return { ok: true, how: "okno ju\u017c zamkni\u0119te" };
      const groups = [];
      for (const b of dlg.querySelectorAll('button[dctypography="bulevar-40"]')) {
        if (!visible(b)) continue;
        let g = groups.find(x => x.el === b.parentElement);
        if (!g) { g = { el: b.parentElement, btns: [] }; groups.push(g); }
        g.btns.push(b);
      }
      const vals = g => g.btns.map(b => parseInt(btnText(b), 10));
      let dbl = null, fin = null;
      if (groups.length >= 2) { dbl = groups[0]; fin = groups[1]; }
      else if (groups.length === 1) { if (vals(groups[0]).includes(0)) dbl = groups[0]; else fin = groups[0]; }
      const confirmBtn = Array.from(dlg.querySelectorAll("button")).find(b => visible(b) && b.hasAttribute("dcbutton"));
      if (!groups.length || !confirmBtn) return { ok: false, how: "nie znam uk\u0142adu okna (brak przycisk\u00f3w)" };
      const a = Core.checkoutAnswer(v.darts, rest, !!fin);
      const finVal = fin ? Core.pickOption(a.forCheckout, vals(fin)) : null;
      let dblVal = dbl ? Core.pickOption(a.atDouble, vals(dbl)) : null;
      if (dbl && finVal != null && dblVal > finVal) dblVal = Core.pickOption(finVal, vals(dbl).filter(x => x <= finVal));
      const click = async (g, val) => { const b = g.btns[vals(g).indexOf(val)]; if (b) { b.click(); await sleep(60); } };
      if (fin && finVal != null) await click(fin, finVal);
      if (dbl && dblVal != null) await click(dbl, dblVal);
      const what = (fin ? "lotki na zako\u0144czenie: " + finVal : "") + (fin && dbl ? ", " : "") + (dbl ? "lotki na podw\u00f3jnej: " + dblVal : "") +
        (a.exact ? "" : " (przybli\u017cenie: reszta nieznana)");
      log("Okno lotek DartCounter: " + what + " (tura " + v.labels + ")");
      if (fin) S.lastOwn = { ts: now(), finish: true, labels: v.labels }; // our checkout: the leg we are about to close is won
      confirmBtn.click();
      const closed = await waitFor(() => !dialogOpen(), 1500);
      return closed ? { ok: true, how: what, finish: !!fin } : { ok: false, finish: !!fin, how: "okno nie zamkn\u0119\u0142o si\u0119 po potwierdzeniu (" + what + ")" };
    }
    // after an entry: answer the dialog when DartCounter shows it (it can appear a moment after the turn)
    async function handleDartsDialog(v, rest) {
      const open = await waitFor(() => dialogOpen(), 700);
      if (!open) return null;
      S.dialogCtx = { v, rest, ts: now(), tries: 0 };
      return answerDialogCtx();
    }
    async function answerDialogCtx() {
      const c = S.dialogCtx;
      c.tries++;
      const r = await answerDartsDialog(c.v, c.rest);
      if (r.ok) { S.dialogCtx = null; return r; }
      if (c.tries >= 2) setErr("DartCounter pyta o lotki, a skrypt nie umia\u0142 odpowiedzie\u0107 (" + r.how + "). Odpowiedz w oknie r\u0119cznie, kolejne tury poczekaj\u0105.",
        { tura: c.v.labels, reszta: c.rest });
      return r;
    }
    function keyboardSetting() {
      try { return localStorage.getItem("inGameKeyboard") || "(domy\u015blna: none na www)"; } catch (_) { return "?"; }
    }

    const PLACEHOLDER_RE = /wpisz wynik|enter (a )?score|punktzahl|score|wynik|puntuaci|punteggio|pontua|punten|pisteet/i;
    const SUBMIT_RE = /^(wy\u015blij|wyslij|submit|senden|s|ok|enter|envoyer|enviar|invia|verzenden|potwierd\u017a|zatwierd\u017a|absenden)$/i;

    function submitButtonNear(el) {
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        const b = Array.from(p.querySelectorAll("button,[type=submit]")).find(x => visible(x) && (x.type === "submit" || SUBMIT_RE.test((x.textContent || "").trim())));
        if (b) return b;
      }
      return null;
    }

    // Finds where to put the score. Does not depend on UI language.
    function findTarget() {
      const hosts = Array.from(document.querySelectorAll("app-keyboard-score-input")).filter(visible);
      for (const h of hosts) {
        const inp = Array.from(h.querySelectorAll("input")).find(i => visible(i) && !i.disabled && !i.readOnly);
        if (inp) return { mode: "input", input: inp, how: "pole tekstowe w app-keyboard-score-input" };
      }
      const inputs = Array.from(document.querySelectorAll("input")).filter(i =>
        visible(i) && !i.disabled && !i.readOnly && /^(text|number|tel|)$/.test(i.type || ""));
      let i = inputs.find(x => x.maxLength === 3 && (x.inputMode === "numeric" || x.getAttribute("inputmode") === "numeric"));
      if (i) return { mode: "input", input: i, how: "pole numeryczne maxlength=3" };
      i = inputs.find(x => PLACEHOLDER_RE.test(x.placeholder || "") && submitButtonNear(x));
      if (i) return { mode: "input", input: i, how: "pole z placeholderem i przyciskiem wysy\u0142ki" };
      if (hosts.length) {
        if (singleKb()) return { mode: "darts", host: hosts[0], how: "klawiatura lotek (Single/Double/Treble)" };
        if (numbersKb() || keyboardSetting() === "numbers") return { mode: "keys", host: hosts[0], how: "klawiatura numeryczna (klawisze)" };
        return { mode: "unsupported", host: hosts[0], how: "klawiatura \u201e" + keyboardSetting() + "\u201d (nieobs\u0142ugiwana)" };
      }
      return null;
    }
    function numbersKb() { return Array.from(document.querySelectorAll("app-numbers-keyboard")).some(visible); }

    function setNativeValue(el, v) {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (d && d.set) d.set.call(el, v); else el.value = v;
    }
    function key(target, k) {
      const code = k === "Enter" ? "Enter" : k === "Backspace" ? "Backspace" : "Digit" + k;
      const kc = k === "Enter" ? 13 : k === "Backspace" ? 8 : 48 + Number(k);
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, { key: k, code, keyCode: kc, which: kc, bubbles: true, cancelable: true }));
      }
    }

    async function typeScore(t, score) {
      const s = String(score);
      if (t.mode === "input") {
        const inp = t.input;
        inp.focus();
        setNativeValue(inp, "");
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        setNativeValue(inp, s);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(30);
        key(inp, "Enter");
      } else {
        const target = document.body;
        if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
        for (let n = 0; n < 3; n++) { key(target, "Backspace"); await sleep(20); }
        for (const ch of s) { key(target, ch); await sleep(30); }
        await sleep(30);
        key(target, "Enter");
      }
    }

    // Enter one score and check that DartCounter took it.
    async function enterAndVerify(t, score) {
      const before = readRemaining().join(",");
      await typeScore(t, score);
      let clickedSubmit = false, changedSince = 0;
      const end = now() + CFG.verifyMs;
      while (now() < end) {
        await sleep(150);
        if (dialogOpen()) return { ok: true, how: "DartCounter pyta o lotki (okno)" };
        // the change must hold for ~300 ms (a rejected score can flash a temporary rest)
        if (readRemaining().join(",") !== before) {
          if (!changedSince) changedSince = now();
          else if (now() - changedSince >= 300) return { ok: true, how: "wynik zmieniony" };
        } else changedSince = 0;
        if (!findTarget()) return { ok: true, how: "kolej przeciwnika" };
        if (!clickedSubmit && t.mode === "input" && now() > end - CFG.verifyMs + 600 && t.input.isConnected && t.input.value === String(score)) {
          const b = submitButtonNear(t.input);
          if (b) { clickedSubmit = true; log("Enter nie zadzia\u0142a\u0142, klikam przycisk wysy\u0142ki"); b.click(); }
        }
      }
      if (score === 0) return { ok: true, how: "0 wys\u0142ane (bez zmiany wyniku, nie da si\u0119 potwierdzi\u0107)" };
      return { ok: false, how: "brak zmiany wyniku" };
    }

    // ----- leader election between DartCounter tabs -----
    async function leaderLoop() {
      for (;;) {
        const v = await gget(K.leader, null);
        const t = now();
        const wants = !!findTarget() || matchPage().ok || !!atcKeys();
        // free lock, own lock, stale lock, or a tab without a match holds it while this tab has one
        if (!v || v.id === tabId || t - v.ts > CFG.leaderStaleMs || (wants && !v.game)) {
          await gset(K.leader, { id: tabId, ts: t, game: wants });
        }
        const cur = await gget(K.leader, null);
        const was = S.leader;
        S.leader = !!cur && cur.id === tabId;
        if (was !== S.leader) { log(S.leader ? "Ta karta DartCounter jest aktywna" : "Inna karta DartCounter jest aktywna, ta czeka"); tracker.reset(); }
        await sleep(1000);
      }
    }

    // ----- source polling -----
    async function pollLoop() {
      for (;;) {
        if (S.enabled && S.leader && S.source === "local") await pollOnce();
        await sleep(CFG.pollMs);
      }
    }
    async function pollOnce() {
      let raw = null, src = null;
      try {
        const r = await gxhr(S.apiBase + "/api/state", CFG.xhrTimeoutMs);
        if (r.status !== 200) throw new Error("HTTP " + r.status);
        raw = JSON.parse(r.text);
        if (!S.apiOk || S.apiErr) log("Po\u0142\u0105czenie z " + S.apiBase + "/api/state OK");
        S.apiOk = now(); S.apiErr = ""; S.apiFails = 0;
        src = "bezpo\u015brednio " + S.apiBase.replace(/^https?:\/\//, "") + "/api/state";
      } catch (e) {
        const m = errText(e);
        S.apiFails++;
        if (m !== S.apiErr) log("Brak po\u0142\u0105czenia z " + S.apiBase + "/api/state: " + m);
        S.apiErr = m;
      }
      if (!raw && now() - S.apiOk > CFG.sourceStaleMs) {
        const rel = await gget(K.relay, null);
        if (rel && now() - rel.ts < CFG.sourceStaleMs) { raw = rel.raw; S.relayOk = rel.ts; src = "karta AutoDarts (" + rel.origin + ")"; }
        else {
          const c = await gget(K.cloud, null);
          if (c && now() - c.ts < CFG.sourceStaleMs * 3) { raw = c.raw; S.cloudOk = c.ts; src = "play.autodarts (chmura, niesprawdzone)"; }
        }
      }
      if (!raw) { S.sourceName = "-"; return; }
      if (src !== S.sourceName) { log("\u0179r\u00f3d\u0142o lotek: " + src); S.sourceName = src; }
      S.lastRaw = raw;
      const st = Core.normalizeState(raw);
      if (!st) return;
      if (st.count) S.lastRawDarts = raw;
      if (st.throwsMissing && !S.warnedMissing) { S.warnedMissing = true; log("API podaje numThrows, ale bez listy lotek. Kliknij \u201eKopiuj surowy stan\u201d i wy\u015blij."); }
      if (st.unknown && st.count) {
        const sig = st.darts.map(d => d.label).join(" ");
        if (sig !== S.warnedUnknown) { S.warnedUnknown = sig; log("Nie rozumiem formatu lotki. Kliknij \u201eKopiuj surowy stan\u201d i wy\u015blij.", raw.throws || raw.darts); }
      }
      S.snap = st;
      tracker.update(st, now());
      soundRules.update("local", st.darts, true);
      bullDarts.update("local", st.darts);
      renderStrip();
    }

    // ----- source "gra": visits published by the play.autodarts game tab -----
    async function playLoop() {
      if (typeof GM_addValueChangeListener === "function") {
        try { GM_addValueChangeListener(K.playVisits, () => { checkPlay(); }); S.listener = true; } catch (e) { log("GM_addValueChangeListener nie dzia\u0142a: " + errText(e)); }
      }
      for (;;) { await checkPlay(); await sleep(300); } // polling as well: the listener is not guaranteed between tabs
    }
    let checking = false;
    async function checkPlay() {
      if (checking) return;
      checking = true;
      try {
        S.playHb = await gget(K.playHb, null);
        S.playLive = await gget(K.playLive, null);
        await checkResetAck();
        const an = await gget(K.autoNext, null);
        if (an && an.ts !== S.autoNextTs) {
          const first = S.autoNextTs === undefined;
          S.autoNextTs = an.ts; S.autoNext = an;
          if (!first && !an.ok) setErr("Autodarts nie przeszed\u0142 sam do kolejnego lega: " + an.how + ". Kliknij \u201eNext Leg\u201d w Autodarts.", { autodarts: an });
          else if (!first) log("Autodarts po wygranym legu \u2713 " + an.how);
        }
        if (S.source === "play" && S.playLive && S.playLive.ts !== S.playLiveSeenTs) {
          S.playLiveSeenTs = S.playLive.ts;
          const liveKey = "gra:" + S.playLive.matchId + "/" + S.playLive.key;
          const liveDarts = (S.playLive.throws || []).map(t => Core.normalizeThrow(t)).filter(Boolean);
          soundRules.update(liveKey, liveDarts);
          bullDarts.update(liveKey, liveDarts);
        }
        const list = (await gget(K.playVisits, [])) || [];
        for (const item of list) {
          if (!item || S.playSeen.has(item.id)) continue;
          if (!S.leader) continue; // another DartCounter tab enters it (shared id list prevents doubles)
          S.playSeen.add(item.id);
          if (!S.enabled || S.source !== "play") continue; // bridge off or other source: never entered later
          if (now() - item.ts > 60000) { log("Pomijam star\u0105 tur\u0119 z gry: " + item.labels); continue; }
          const darts = (item.throws || []).map(t => { const d = Core.normalizeThrow(t); if (d) d.raw = t; return d; }).filter(Boolean);
          log("Z gry Autodarts: " + item.labels + " (" + item.reason + ", id " + item.id + ")" +
            (item.busted ? " | Autodarts: przerzucenie" : "") + (item.points != null ? " | punkty Autodarts: " + item.points : ""));
          await onVisit({ id: "gra:" + item.id, darts, detected: darts, ov: {}, reason: "gra: " + item.reason, corrected: false,
            variant: item.variant || "", adSettings: item.settings || null, adFinished: !!item.finished });
        }
      } finally { checking = false; }
    }

    // ----- visits -----
    async function onVisit(v) {
      const labels = v.darts.map(d => d.label).join(" ");
      const total = v.darts.reduce((a, d) => a + d.score, 0);
      S.lastVisit = { labels, total, ts: now() };
      log("Tura: " + labels + " = " + total + " (" + v.reason + ")" + (v.extraDarts ? " UWAGA: wi\u0119cej ni\u017c 3 lotki, licz\u0119 3" : ""));
      if (v.darts.some(d => !d.ok)) { setErr("Nie rozpoznano lotki (" + labels + "). Tury nie wpisuj\u0119. Kliknij \u201eKopiuj surowy stan\u201d."); return; }
      if (!S.enabled) { log("Most wy\u0142\u0105czony, tury nie wpisuj\u0119"); return; }
      if (!v.darts.length) return; // never enter anything without new darts
      const last = await gget(K.lastEntered, null);
      const entered = (await gget(K.enteredIds, [])) || [];
      if (S.queue.some(q => q.id === v.id) || (last && last.id === v.id) || entered.includes(v.id)) { log("Pomijam duplikat wizyty " + v.id); return; }
      // local source only: game visits have a reliable id, identical consecutive visits there are real
      if (!/^gra:/.test(v.id) && last && last.labels === labels && now() - last.ts < CFG.dupWindowMs) { log("Pomijam duplikat tej samej tury (" + labels + ")"); return; }
      S.queue.push({ darts: v.darts, labels, total, ts: now(), id: v.id, detected: v.detected || v.darts, ov: v.ov || {},
        variant: v.variant || "", adSettings: v.adSettings || null, adFinished: !!v.adFinished,
        corrected: !!v.corrected, readyAt: now() + S.sendDelay * 1000 });
      if (v.corrected) log("Tura z korekt\u0105: AutoDarts " + (v.detected || []).map(d => d.label).join(" ") + " \u2192 wysy\u0142am " + labels);
      renderStrip();
    }

    async function queueLoop() {
      let waitingLogged = null;
      for (;;) {
        await sleep(200);
        if (!S.queue.length || S.busy || !S.leader) continue;
        const v = S.queue[0];
        // time while DartCounter shows its darts dialog does not count: the visit waits for the answer, never dropped for it
        if (dialogOpen()) v.ts = Math.max(v.ts, now() - CFG.visitMaxAgeMs + 30000);
        if (now() - v.ts > CFG.visitMaxAgeMs) { S.queue.shift(); missed(v, "czeka\u0142a za d\u0142ugo (" + Math.round(CFG.visitMaxAgeMs / 1000) + " s): " + (S.waitWhy || "brak pola wyniku w DartCounter")); continue; }
        if (now() < v.readyAt) { renderStrip(); continue; } // time to correct darts after the takeout
        const page = atcPage() ? "atc" : "x01";
        if (!Core.visitFits(v.variant, page)) {
          S.queue.shift();
          missed(v, "Autodarts gra \u201e" + v.variant + "\u201d, a DartCounter ma otwarte " +
            (page === "atc" ? "Around the Clock" : "X01") + ". Uruchom w DartCounter t\u0119 sam\u0105 gr\u0119.", { wariant: v.variant, strona: location.pathname });
          continue;
        }
        if (page === "atc") {
          if (atcFinishedOrDialog()) {
            if (waitingLogged !== v.id + "atcend") { waitingLogged = v.id + "atcend"; log("ATC: czekam (okno DartCounter albo gra sko\u0144czona)"); }
            continue;
          }
          if (!atcKeys()) {
            if (waitingLogged !== v.id + "atck") {
              waitingLogged = v.id + "atck";
              log(atcBoardKeyboard() ? "ATC: DartCounter ma klawiatur\u0119 z tarcz\u0105 (nieobs\u0142ugiwana). Wybierz zwyk\u0142\u0105 klawiatur\u0119 z przyciskami S/D/T i Miss."
                : "ATC: czekam na klawiatur\u0119 DartCounter (np. rzuca DartBot)");
            }
            continue;
          }
          S.busy = true; renderStrip();
          try { await enterAtcVisit(v); } catch (e) { missed(v, "wpis ATC nie wyszed\u0142: " + errText(e)); }
          S.queue.shift();
          if (v.adFinished) atcAutodartsEnded(v);
          S.busy = false; renderStrip();
          continue;
        }
        if (!matchPage().ok && !findTarget()) {
          S.queue.shift();
          missed(v, "to nie jest strona meczu X01 (" + location.pathname + ")");
          continue;
        }
        if (dialogOpen()) {
          // the dialog of our previous visit (it may open late): answer it; any other dialog waits for the player
          if (S.dialogCtx && now() - S.dialogCtx.ts < 60000 && S.dialogCtx.tries < 2) {
            S.busy = true;
            try { await answerDialogCtx(); } catch (e) { log("Okno lotek: " + errText(e)); }
            S.busy = false;
            continue;
          }
          S.waitWhy = "DartCounter pyta o lotki";
          if (waitingLogged !== v.id + "dlg") {
            waitingLogged = v.id + "dlg";
            setErr("DartCounter pyta o lotki. Odpowiedz w oknie, tura " + v.labels + " czeka i wpisze si\u0119 potem.", { tura: v.labels });
          }
          continue;
        }
        const t = findTarget();
        if (t && t.mode === "unsupported") {
          // wait (up to visitMaxAgeMs) until the player switches to a keyboard that can take the visit
          S.waitWhy = t.how;
          if (waitingLogged !== v.id + "kb") {
            waitingLogged = v.id + "kb";
            setErr("Czekam z tur\u0105 " + v.labels + ": " + t.how + ". Wybierz w DartCounter klawiatur\u0119 Single/Double/Treble, numeryczn\u0105 albo pole \u201eWpisz wynik\u201d.",
              { tura: v.labels, klawiatura: keyboardSetting() });
          }
          continue;
        }
        if (!t) {
          S.waitWhy = "brak pola wyniku (np. rzuca przeciwnik)";
          if (waitingLogged !== v.id + "t") { waitingLogged = v.id + "t"; log("Czekam na pole wyniku (np. rzuca DartBot)"); }
          continue;
        }
        S.waitWhy = "";
        S.busy = true; renderStrip();
        let res;
        const snap = readRemaining().join(",");
        try { res = await enterVisit(v, t); } catch (e) {
          // retry only when DartCounter shows no trace of this visit
          res = { ok: false, how: errText(e), retry: readRemaining().join(",") === snap && !enteredSlots(scoreHost()).length && !dialogOpen() };
        }
        if (res && !res.ok && res.retry && (v.tries = (v.tries || 0) + 1) <= 2) {
          // nothing of this visit reached DartCounter: try again a moment later (the visit stays first in the queue)
          log("Ponawiam tur\u0119 " + v.labels + " (pr\u00f3ba " + (v.tries + 1) + "/3): " + res.how);
          v.readyAt = now() + 1500;
        } else {
          S.queue.shift();
          if (res && !res.ok) missed(v, res.how);
        }
        S.busy = false; renderStrip();
      }
    }

    function currentRemaining() {
      const r = readRemaining();
      if (r.length === 1 && r[0] != null) return { rem: r[0], reliable: true, idx: 0 };
      if (r.length >= 2 && S.lastChangedIdx != null) {
        const idx = (S.lastChangedIdx + 1) % r.length;
        if (r[idx] != null) return { rem: r[idx], reliable: false, idx };
      }
      return { rem: null, reliable: false, idx: null };
    }

    // ----- per-dart entry (DartCounter keyboard "single") -----
    const btnText = b => (b.textContent || "").replace(/\s+/g, " ").trim();
    // the per-dart keyboard with S/D/T and number buttons (keyboard "single"; "dartboard" has no number buttons)
    function singleKb() {
      return Array.from(document.querySelectorAll("app-single-dart-keyboard")).find(kb =>
        Array.from(kb.querySelectorAll('[dctypography="bulevar-32"]')).filter(visible).length >= 20) || null;
    }
    function scoreHost() { return Array.from(document.querySelectorAll("app-keyboard-score-input")).find(visible) || null; }
    function kbButtons(kb) { return Array.from(kb.querySelectorAll("button")).filter(visible); }
    function bustConfirm(kb) { return kb ? kbButtons(kb).find(b => b.hasAttribute("dcbutton")) || null : null; }
    function enteredSlots(host) {
      if (!host) return [];
      return Array.from(host.querySelectorAll('[dctypography="bulevar-40"]')).filter(visible).map(el => {
        const lab = el.parentElement && el.parentElement.querySelector('[dctypography="geist-12-medium"]');
        return lab ? btnText(lab) : "";
      });
    }
    function expectedSlotLabel(d) {
      if (d.multiplier === 0) return null; // miss: localized text
      if (d.number === 25) return d.multiplier === 2 ? "D25" : "S25";
      return ["", "S", "D", "T"][d.multiplier] + d.number;
    }
    // one button per dart field: "20" is the number button 20 (never the digits 2 and 0)
    function multButton(kb, m) { return kbButtons(kb).find(b => btnText(b).toLowerCase() === ["", "single", "double", "treble"][m]) || null; }
    function numberButton(kb, n) {
      return kbButtons(kb).find(b => { const x = b.querySelector('[dctypography="bulevar-32"]'); return x && btnText(x) === String(n); }) || null;
    }
    function singleButton(kb, d) {
      const bs = kbButtons(kb);
      if (d.multiplier === 0) return bs.find(b => b.classList.contains("!uppercase") && !b.hasAttribute("dcbutton")) || null;
      if (d.number === 25 && d.multiplier === 2) return bs.find(b => /bull/i.test(btnText(b)) && /50/.test(btnText(b))) || null;
      if (d.number === 25) return bs.find(b => /outer/i.test(btnText(b)) && /25/.test(btnText(b))) || null;
      return null;
    }
    // Clicks one dart: Miss / Outer 25 / Bull 50 directly; 1-20: multiplier first, then the number button,
    // looked up again after the multiplier click (DartCounter may redraw the buttons).
    async function clickDart(d) {
      const kb = singleKb();
      if (!kb) return "brak klawiatury lotek";
      if (d.multiplier === 0 || d.number === 25) {
        const b = singleButton(kb, d);
        if (!b) return "brak przycisku " + d.label;
        b.click(); return "";
      }
      const m = multButton(kb, d.multiplier);
      if (!m) return "brak przycisku mno\u017cnika dla " + d.label;
      m.click(); await sleep(40);
      let kb2 = singleKb(), m2 = kb2 && multButton(kb2, d.multiplier);
      if (m2 && !m2.classList.contains("selectedMultiplier")) { m2.click(); await sleep(60); kb2 = singleKb(); }
      const num = kb2 && numberButton(kb2, d.number);
      if (!num) return "brak przycisku " + d.number;
      num.click(); return "";
    }
    async function waitFor(fn, ms) {
      const end = now() + ms;
      for (;;) { const r = fn(); if (r) return r; if (now() > end) return null; await sleep(60); }
    }

    // Clicks the darts one by one. Never clicks "Submit" when no dart of this visit is entered.
    async function enterDarts(v) {
      const host0 = scoreHost();
      if (!singleKb() || !host0) return { ok: false, aborted: true, nothing: true, how: "brak klawiatury lotek \u201esingle\u201d w DartCounter" };
      const pre = enteredSlots(host0).length;
      if (pre > 0) return { ok: false, aborted: true, how: "w DartCounter s\u0105 ju\u017c wpisane lotki tej tury (" + pre + "). Doko\u0144cz je r\u0119cznie" };
      const remBefore = readRemaining().join(",");
      let n = 0, stop = "";
      for (const d of v.darts) {
        const kb = singleKb();
        if (!kb) { stop = "tura zako\u0144czona przez DartCounter"; break; }
        if (bustConfirm(kb)) { stop = "DartCounter zg\u0142osi\u0142 przerzucenie"; break; }
        const miss = await clickDart(d);
        if (miss) return { ok: false, aborted: true, nothing: n === 0 && !enteredSlots(scoreHost()).length, how: miss + " (wpisane lotki: " + n + ")" };
        await sleep(40);
        n++;
        const r = await waitFor(() => {
          const h = scoreHost(), k = singleKb();
          if (!h || !k) return "end";
          if (bustConfirm(k)) return "bust";
          const slots = enteredSlots(h);
          if (slots.length === n) return "ok";
          if (slots.length === 0 && readRemaining().join(",") !== remBefore) return "end";
          return null;
        }, 1500);
        if (!r) return { ok: false, aborted: true, how: "DartCounter nie przyj\u0105\u0142 lotki " + n + " (" + d.label + ")" };
        if (r === "ok") {
          const got = enteredSlots(scoreHost())[n - 1] || "";
          const exp = expectedSlotLabel(d);
          const fine = exp ? got.replace(/\s+/g, "").toUpperCase() === exp : !/\d/.test(got);
          if (!fine) return { ok: false, aborted: true, how: "lotka " + n + ": DartCounter pokazuje \u201e" + got + "\u201d zamiast " + d.label + ". Popraw r\u0119cznie" };
          log("Lotka " + n + ": " + d.label + " \u2713");
        } else { log("Lotka " + n + ": " + d.label + " \u2713 (" + (r === "bust" ? "DartCounter: przerzucenie / z\u0142a ko\u0144c\u00f3wka" : "DartCounter zamkn\u0105\u0142 tur\u0119") + ")"); break; }
      }
      if (stop) log("Dalsze lotki pomini\u0119te: " + stop);
      const kb = singleKb();
      const confirm = bustConfirm(kb);
      if (confirm) { log("Potwierdzam w DartCounter (przerzucenie / z\u0142a ko\u0144c\u00f3wka)"); confirm.click(); }
      else if (kb && enteredSlots(scoreHost()).length > 0) {
        const sub = scoreHost().querySelector("button.submit-button");
        if (!sub) return { ok: false, aborted: true, how: "brak przycisku wysy\u0142ki tury" };
        sub.click();
      }
      const done = await waitFor(() => {
        if (dialogOpen()) return "DartCounter pyta o lotki (okno)";
        const h = scoreHost(), k = singleKb();
        if (!h || !k) return "kolej przeciwnika";
        if (enteredSlots(h).length === 0 && !bustConfirm(k)) return "tura zatwierdzona";
        return null;
      }, CFG.verifyMs);
      return done ? { ok: true, how: n + " lotk" + (n === 1 ? "a" : n < 5 ? "i" : "ek") + ", " + done } : { ok: false, aborted: true, how: "tura nie zosta\u0142a zatwierdzona w DartCounter" };
    }

    // ----- Around the Clock: DartCounter hit keyboard -----
    function atcDcSettings() {
      try { return JSON.parse(localStorage.getItem("localAroundTheClockSettings") || "null"); } catch (_) { return null; }
    }
    function atcInput() { return Array.from(document.querySelectorAll("app-around-the-clock-single-dart-input")).find(visible) || null; }
    function atcBoardKeyboard() { return atcPage() && Array.from(document.querySelectorAll("app-single-dart-keyboard")).some(visible); }
    // the hit keyboard: rows of S/D/T (current target), bull key(s), and undo + Miss (+ one hit key for single/double/treble)
    function atcKeys() {
      if (!atcPage()) return null;
      const undo = Array.from(document.querySelectorAll("button.icon-key")).find(b => visible(b) && b.querySelector('app-icon[icon="undo_outline"]'));
      if (!undo || !undo.parentElement || !undo.parentElement.parentElement) return null;
      const lastRow = undo.parentElement, box = lastRow.parentElement;
      const rowKeys = Array.from(lastRow.querySelectorAll("button.key")).filter(visible);
      const miss = rowKeys[0] || null;
      const all = Array.from(box.querySelectorAll("button.key")).filter(visible);
      const sdt = {};
      for (const b of all) { const m = /^([SDT])(\d{1,2})$/.exec(btnText(b)); if (m && b.parentElement !== lastRow) sdt[m[1]] = { b, n: Number(m[2]) }; }
      const bullRow = Array.from(box.children).find(r => r !== lastRow && Array.from(r.querySelectorAll("button.key")).some(b => !/^[SDT]\d{1,2}$/.test(btnText(b))));
      const bullKeys = bullRow ? Array.from(bullRow.querySelectorAll("button.key")).filter(visible) : [];
      const hitKey = rowKeys[1] || null; // single/double/treble segments: one key with the target label
      return { box, miss, sdt, bullKeys, hitKey };
    }
    function atcTarget(k, cfg) {
      if (!k) return null;
      if (k.bullKeys.length) return { kind: "bull" };
      if (cfg.segment === "all") { const any = k.sdt.S || k.sdt.D || k.sdt.T; return any ? { kind: "number", n: any.n } : null; }
      if (k.hitKey) { const m = /(\d{1,2})$/.exec(btnText(k.hitKey)); if (m) return { kind: "number", n: Number(m[1]) }; }
      return null;
    }
    function atcSlots() {
      const inp = atcInput();
      return inp ? Array.from(inp.querySelectorAll('[dctypography="bulevar-40"]')).filter(visible).map(e => btnText(e)) : [];
    }
    function atcFinishedOrDialog() {
      return Array.from(document.querySelectorAll("app-around-the-clock-local-end-screen-dialog, app-local-end-screen, ion-modal")).some(visible);
    }
    function atcButtonFor(k, key) {
      if (key === "miss") return k.miss;
      if (key === "S" || key === "D" || key === "T") return k.sdt[key] ? k.sdt[key].b : null;
      if (key === "hit") return k.hitKey;
      if (key === "bull") return k.bullKeys[0] || null;
      if (key === "singlebull") return k.bullKeys.length === 2 ? k.bullKeys[0] : null;
      if (key === "bullseye") return k.bullKeys.length === 2 ? k.bullKeys[1] : null;
      return null;
    }

    // Each Autodarts dart -> one DartCounter ATC key (hit on the current target or Miss), then the turn is submitted.
    async function enterAtcVisit(v) {
      const cfg = Core.atcDcConfig(atcDcSettings());
      if (!cfg.ok) { setErr("ATC: tura " + v.labels + " pomini\u0119ta: " + cfg.why + ".", { tura: v.labels, ustawieniaDC: cfg }); return; }
      const chk = Core.atcAutodartsCheck(v.adSettings, cfg);
      if (!chk.ok) { setErr("ATC: tura " + v.labels + " pomini\u0119ta: " + chk.why + ".", { tura: v.labels, autodarts: v.adSettings, dartcounter: cfg }); return; }
      const pre = atcSlots().length;
      if (pre > 0) { setErr("ATC: w DartCounter s\u0105 ju\u017c wpisane lotki tej tury (" + pre + "). Doko\u0144cz tur\u0119 r\u0119cznie.", { tura: v.labels }); return; }
      await gset(K.lastEntered, { id: v.id, labels: v.labels, ts: now() });
      const entered = (await gget(K.enteredIds, [])) || [];
      entered.push(v.id); while (entered.length > 50) entered.shift();
      await gset(K.enteredIds, entered);
      log("ATC: wpisuj\u0119 " + v.labels + " (bull: " + cfg.throwout + ", segmenty: " + cfg.segment + ", trafienia: " + cfg.hits + ")");
      const keys = [];
      let n = 0;
      for (const d of v.darts) {
        const k = atcKeys();
        const target = atcTarget(k, cfg);
        if (!k || !target) { log("ATC: koniec cel\u00f3w w DartCounter, dalsze lotki pomini\u0119te"); break; }
        const key = Core.atcKey(d, target, cfg);
        const btn = atcButtonFor(k, key);
        if (!btn) { setErr("ATC: brak przycisku \u201e" + key + "\u201d dla " + d.label + " (cel " + (target.kind === "bull" ? "bull" : target.n) + ").", { tura: v.labels }); return; }
        btn.click();
        n++; keys.push(d.label + "\u2192" + (key === "miss" ? "Miss" : key));
        const r = await waitFor(() => {
          if (atcFinishedOrDialog() || !atcKeys()) return "end";
          const sl = atcSlots();
          if (sl.length === n) return "ok";
          if (sl.length === 0) return "submitted"; // auto-submit after the 3rd dart / finish
          return null;
        }, 1500);
        if (!r) { setErr("ATC: DartCounter nie przyj\u0105\u0142 lotki " + n + " (" + d.label + ").", { tura: v.labels }); return; }
        if (r !== "ok") break;
      }
      // submit whenever darts of this turn wait (also after the finishing bull, when DartCounter shows no target keys)
      if (atcSlots().length > 0 && !atcFinishedOrDialog()) {
        const inp = atcInput(), sub = inp && inp.querySelector("button.submit-button");
        if (!sub) { setErr("ATC: brak przycisku wysy\u0142ki tury w DartCounter.", { tura: v.labels }); return; }
        sub.click();
      }
      const done = await waitFor(() => (atcFinishedOrDialog() ? "koniec gry / okno" : !atcKeys() ? "kolej przeciwnika" : atcSlots().length === 0 ? "tura zatwierdzona" : null), CFG.verifyMs);
      S.lastEntry = { score: v.labels, labels: v.labels, ok: !!done, how: done || "tura nie zatwierdzona", ts: now() };
      if (done) { log("ATC: wpisano " + keys.join(", ") + " \u2713 (" + done + ")"); S.err = ""; }
      else setErr("ATC: tura " + v.labels + " nie zosta\u0142a zatwierdzona w DartCounter. Kliknij \u201eSubmit\u201d r\u0119cznie (klawiatura DartCounter: " + keyboardSetting() + ").", { tura: v.labels });
    }

    async function enterVisit(v, t) {
      if (t.mode === "unsupported") {
        setErr("Nic nie wpisano: " + t.how + ". W DartCounter wybierz klawiatur\u0119 Single/Double/Treble, numeryczn\u0105 albo pole \u201eWpisz wynik\u201d.",
          { tura: v.labels, klawiatura: keyboardSetting() });
        S.lastEntry = { score: v.labels, labels: v.labels, ok: false, how: t.how, ts: now() };
        return { ok: false, how: t.how, retry: false };
      }
      if (t.mode === "darts" && S.entryMode !== "darts") log("DartCounter ma klawiatur\u0119 lotek: wpisuj\u0119 lotka po lotce.");
      if (S.entryMode === "darts" || t.mode === "darts") {
        if (singleKb()) {
          await gset(K.lastEntered, { id: v.id, labels: v.labels, ts: now() });
          const entered = (await gget(K.enteredIds, [])) || [];
          entered.push(v.id); while (entered.length > 50) entered.shift();
          await gset(K.enteredIds, entered);
          log("Wpisuj\u0119 lotka po lotce: " + v.labels + (v.corrected ? " (lotki poprawione r\u0119cznie)" : ""));
          const rest0 = currentRemaining();
          const res = await enterDarts(v);
          S.lastEntry = { score: v.labels, labels: v.labels, ok: res.ok, how: res.how, ts: now() };
          if (res.ok) {
            const dlg = await handleDartsDialog(v, rest0.rem);
            log("Wpisano lotki " + v.labels + " \u2713 (" + res.how + (dlg && dlg.ok ? "; okno: " + dlg.how : "") + ")");
            noteOwnEntry(v, rest0, dlg);
            if (!dlg || dlg.ok) S.err = "";
            return { ok: true };
          }
          setErr("Wpis lotek " + v.labels + " przerwany: " + res.how, { tura: v.labels, klawiatura: keyboardSetting(), wpisaneLotki: enteredSlots(scoreHost()) });
          return { ok: false, how: res.how, retry: !!res.nothing };
        }
        log("Tryb \u201elotka po lotce\u201d, ale DartCounter nie ma klawiatury \u201esingle\u201d (" + keyboardSetting() + "). Wpisuj\u0119 sum\u0119 tury.");
      }
      const cur = currentRemaining();
      const d = Core.decideScore(v.darts, cur.rem, cur.reliable, S.doubleOut);
      if (d.note) log("Decyzja: " + d.score + " (" + d.note + ")");
      await gset(K.lastEntered, { id: v.id, labels: v.labels, ts: now() });
      const entered = (await gget(K.enteredIds, [])) || [];
      entered.push(v.id); while (entered.length > 50) entered.shift();
      await gset(K.enteredIds, entered);
      log("Wpisuj\u0119 " + d.score + (v.corrected ? " (lotki poprawione r\u0119cznie: " + v.labels + ")" : "") + " (" + t.how + ")");
      let res = await enterAndVerify(t, d.score);
      let score = d.score;
      if (!res.ok && d.score > 0) {
        // Automatic 0 only when this visit really looks like a bust for a visible rest.
        const r = readRemaining();
        const cand = cur.idx != null ? [r[cur.idx]] : r;
        const minRest = S.doubleOut ? 2 : 1;
        const bust = cand.some(x => x != null && d.score !== x && d.score > x - minRest);
        await sleep(1000);
        const t2 = findTarget();
        if (bust && t2 && readRemaining().join(",") === r.join(",") && !dialogOpen()) {
          log("DartCounter nie przyj\u0105\u0142 " + d.score + " (przerzucenie, reszta " + cand.join("/") + "). Wpisuj\u0119 0 za t\u0119 tur\u0119.");
          res = await enterAndVerify(t2, 0); score = 0;
        } else {
          log("DartCounter nie przyj\u0105\u0142 " + d.score + ". Nic wi\u0119cej nie wpisuj\u0119.");
        }
      }
      if (res.ok && score === 0 && cur.idx != null) S.lastChangedIdx = cur.idx;
      S.lastEntry = { score, labels: v.labels, ok: res.ok, how: res.how, ts: now() };
      if (res.ok) {
        const dlg = await handleDartsDialog(v, cur.rem);
        log("Wpisano " + score + " \u2713 (" + res.how + (dlg && dlg.ok ? "; okno: " + dlg.how : "") + ")");
        noteOwnEntry(v, cur, dlg);
        if (!dlg || dlg.ok) S.err = "";
        return { ok: true };
      }
      setErr("Wpis " + score + " nie zadzia\u0142a\u0142 (" + res.how + "). Klawiatura w DartCounter: " + keyboardSetting(),
        { tura: v.labels, wynik: score, sposob: t.how, reszta: readRemaining() });
      return { ok: false, how: res.how, retry: false };
    }

    // a visit that did not reach DartCounter: never silent (panel row, red dot, log, console.warn) until "Wyczy\u015b\u0107 niewpisane"
    function missed(v, why, details) {
      S.missed.push({ labels: v.labels, why, ts: now() });
      while (S.missed.length > 10) S.missed.shift();
      setErr("Tura " + v.labels + " NIE wpisana: " + why + ". Wpisz j\u0105 w DartCounter r\u0119cznie.", Object.assign({ tura: v.labels }, details || {}));
    }
    // a visit of ours reached DartCounter: remember whether it ended the leg (finish)
    function noteOwnEntry(v, cur, dlg) {
      const fin = dlg ? !!dlg.finish : cur.rem != null && Core.checkoutAnswer(v.darts, cur.rem, false).finished;
      S.lastOwn = { ts: now(), finish: fin, labels: v.labels };
    }

    // errors: panel + log + one readable console.warn with the details
    function setErr(m, details) {
      S.err = m; log("B\u0141\u0104D: " + m);
      try {
        console.warn(PREFIX + " B\u0141\u0104D wpisu (" + VERSION + "): " + m, Object.assign({
          zrodlo: S.source, wpis: S.entryMode, klawiaturaDC: keyboardSetting(), strona: location.pathname }, details || {}));
      } catch (_) {}
    }

    // ----- end of a DartCounter leg / match -> fresh X01 game in Autodarts (setting "Reset Autodarts") -----
    const START_SCORES = [101, 170, 201, 301, 401, 501, 601, 701, 801, 901, 1001];
    function endScreenOpen() {
      return Array.from(document.querySelectorAll("app-match-local-end-screen-dialog,app-match-online-end-screen-dialog,app-local-end-screen")).some(visible);
    }
    // legs / sets won per player (app-in-game-interim-score, one per player: [sets, legs] or [legs])
    function readInterims() {
      return Array.from(document.querySelectorAll("app-in-game-interim-score")).filter(visible)
        .map(el => ((el.textContent || "").match(/\d+/g) || []).map(Number));
    }
    // Two signals for a new leg, each compared with the last COMPLETE reading (a moment without scores, e.g. while
    // DartCounter redraws between legs, does not wipe it): the rests back to the start score, or a legs counter + 1.
    function watchLegEnd(r) {
      if (atcPage() || !matchPage().ok) { S.endScreen = false; S.legSnap = null; S.interimSnap = null; return; }
      if (r.length && r.every(x => x != null)) {
        const prev = S.legSnap;
        if (S.startScore == null && r.every(x => x === r[0]) && START_SCORES.includes(r[0])) S.startScore = r[0];
        if (prev && prev.length === r.length && prev.join(",") !== r.join(",")) {
          const end = Core.legEndFromRests(prev, r, S.startScore);
          if (end) { S.startScore = r[0]; legEnded("leg", "reszty " + prev.join("/") + " \u2192 " + r.join("/")); }
          else if (r.some((x, i) => x > prev[i])) log("Diagnostyka: reszty " + prev.join("/") + " \u2192 " + r.join("/") + " (wzros\u0142y, ale to nie nowy leg: start " + (S.startScore == null ? "?" : S.startScore) + ")");
        }
        S.legSnap = r;
      }
      const it = readInterims();
      if (it.length && it.every(x => x.length)) {
        const prev = S.interimSnap;
        const sig = x => x.map(a => a.join(":")).join(" ");
        if (prev && sig(prev) !== sig(it)) {
          if (Core.interimLegEnd(prev, it)) legEnded("leg", "legi " + sig(prev) + " \u2192 " + sig(it));
          else log("Diagnostyka: licznik leg\u00f3w " + sig(prev) + " \u2192 " + sig(it) + " (nie nowy leg, np. cofni\u0119cie)");
        }
        S.interimSnap = it;
      }
      const es = endScreenOpen();
      if (es && !S.endScreen) legEnded("match", "ekran ko\u0144ca meczu");
      S.endScreen = es;
    }
    // evaluated a moment later: our own checkout entry finishes (dialog answer) before we decide won / lost
    function legEnded(kind, why) {
      if (S.pendingEnd) { if (kind === "match") S.pendingEnd.kind = "match"; S.pendingEnd.why += ", " + why; return; }
      if (now() - S.lastLegEndTs < 5000) { log("Diagnostyka: ten sam koniec lega (" + why + ")"); return; } // new leg + end screen of the same checkout
      log("Wykryto koniec " + (kind === "match" ? "meczu" : "lega") + " w DartCounter (" + why + ")");
      S.pendingEnd = { kind, ts: now(), why };
      setTimeout(finishLegEnd, 1200);
    }
    function finishLegEnd() {
      const p = S.pendingEnd;
      if (!p) return;
      if (S.busy && now() - p.ts < 10000) { setTimeout(finishLegEnd, 300); return; }
      S.pendingEnd = null;
      S.lastLegEndTs = now();
      const solo = readRemaining().length === 1;
      const won = !!(S.lastOwn && S.lastOwn.finish) || solo;
      const whyWon = solo ? "jeden gracz" : S.lastOwn ? (S.lastOwn.finish ? "zako\u0144czy\u0142a Twoja tura " + S.lastOwn.labels : "Twoja ostatnia tura " + S.lastOwn.labels + " bez zako\u0144czenia") : "brak Twojej tury od ostatniego lega";
      S.lastOwn = null;
      const what = (p.kind === "match" ? "koniec meczu" : "koniec lega") + " (" + (won ? "wygrany" : "przegrany") + ")";
      log("DartCounter: " + what + " | " + whyWon + " | ustawienie: " + RESET_MODES[S.resetMode] + " | \u017ar\u00f3d\u0142o: " + S.source + " | aktywna karta: " + S.leader);
      if (!S.enabled || !S.leader) { log("Reset Autodarts: pomijam (" + (!S.enabled ? "most wy\u0142\u0105czony" : "inna karta DartCounter jest aktywna") + ")"); return; }
      if (!Core.resetWanted(S.resetMode, p.kind, won)) { log("Reset Autodarts: nie teraz (" + RESET_MODES[S.resetMode] + ")"); return; }
      if (S.source !== "play") { log("Reset Autodarts dzia\u0142a tylko ze \u017ar\u00f3d\u0142em \u201egra Autodarts\u201d"); return; }
      requestReset(p.kind, won, what);
    }
    // Around the Clock only: Autodarts may close its game on the outer bull (25) while DartCounter ("Finish by hitting
    // the bullseye") still waits for 50. DartCounter took the 25 as a miss; the Autodarts game is started again so the
    // next darts keep coming. X01 never comes here.
    async function atcAutodartsEnded(v) {
      await sleep(1500);
      if (!atcPage()) return;
      if (atcFinishedOrDialog()) { log("ATC: Autodarts i DartCounter sko\u0144czy\u0142y gr\u0119 (" + v.labels + ")"); return; }
      log("ATC: Autodarts zamkn\u0105\u0142 gr\u0119 po turze " + v.labels + ", DartCounter gra dalej (cel: " + (atcTarget(atcKeys(), Core.atcDcConfig(atcDcSettings())) || {}).kind + ")");
      if (!S.enabled || !S.leader) { log("ATC: wznowienie Autodarts pomini\u0119te (" + (!S.enabled ? "most wy\u0142\u0105czony" : "inna karta DartCounter jest aktywna") + ")"); return; }
      if (S.resetMode === "off") { log("ATC: wznowienie Autodarts wy\u0142\u0105czone (Reset Autodarts: " + RESET_MODES.off + "). Zacznij gr\u0119 w Autodarts r\u0119cznie."); return; }
      if (S.source !== "play") { log("ATC: wznowienie Autodarts dzia\u0142a tylko ze \u017ar\u00f3d\u0142em \u201egra Autodarts\u201d"); return; }
      requestReset("atc", false, "ATC: Autodarts sko\u0144czy\u0142, DartCounter gra dalej");
    }
    async function requestReset(kind, won, what) {
      const cmd = { id: tabId + "-" + now().toString(36), ts: now(), kind, won };
      S.reset = { id: cmd.id, ts: now(), state: "sent", how: "czekam na kart\u0119 gry", what, game: kind === "atc" ? "Around the Clock" : "X01" };
      await gset(K.resetCmd, cmd);
      log("Reset Autodarts: polecenie " + cmd.id + " do karty gry (" + what + ")" + (playTabFresh() ? "" : " | UWAGA: karta gry nie daje znaku \u017cycia"));
    }
    // answer of the game tab (read in the play loop)
    async function checkResetAck() {
      const r = S.reset;
      if (!r || r.state === "ok" || r.state === "fail") return;
      const ack = await gget(K.resetAck, null);
      if (ack && ack.id === r.id && (ack.state !== r.state || ack.how !== r.how)) {
        r.state = ack.state; r.how = ack.how; r.ackTs = now();
        if (ack.state === "busy") log("Reset Autodarts: karta gry: " + ack.how);
        if (ack.state === "ok") log("Reset Autodarts \u2713 " + ack.how);
        if (ack.state === "fail") setErr("Reset Autodarts nie wyszed\u0142: " + ack.how + ". Zacznij w Autodarts now\u0105 gr\u0119 " + r.game + " r\u0119cznie (tury nie gin\u0105, wpisuj\u0105 si\u0119 dalej).", { reset: r.what });
        return;
      }
      if (r.state === "sent" && now() - r.ts > 8000) {
        r.state = "fail"; r.how = "karta gry nie odpowiada";
        setErr("Reset Autodarts: karta gry nie odpowiada (otwarta? od\u015bwie\u017cona po aktualizacji skryptu?). Zacznij w Autodarts now\u0105 gr\u0119 " + r.game + " r\u0119cznie.", { reset: r.what });
      } else if (r.state === "busy" && now() - (r.ackTs || r.ts) > 120000) {
        r.state = "fail"; r.how = "brak wyniku po 2 min";
        setErr("Reset Autodarts: brak wyniku z karty gry. Sprawd\u017a Autodarts i w razie potrzeby zacznij now\u0105 gr\u0119 " + r.game + " r\u0119cznie.", { reset: r.what });
      }
    }

    // ----- whose turn: remember which player's rest changed last -----
    function watchRemaining() {
      const r = readRemaining();
      watchLegEnd(r);
      if (r.length !== S.rem.length) { S.lastChangedIdx = null; S.rem = r; return; }
      const changed = [];
      for (let i = 0; i < r.length; i++) if (r[i] !== S.rem[i]) changed.push(i);
      if (changed.length === 1) S.lastChangedIdx = changed[0];
      else if (changed.length > 1) S.lastChangedIdx = null;
      S.rem = r;
    }

    // ----- dart correction (strip above the panel) -----
    function slotView(d, edited) {
      return d ? { label: d.label, edited: !!edited, mult: d.multiplier, num: d.number } : (edited ? { label: "\u2715", edited: true, mult: 1, num: null } : null);
    }
    function renderStrip() {
      if (!S.enabled || !S.leader) { ui.setStrip(null, onPick); return; }
      const q = S.queue[0];
      if (q) {
        const slots = [0, 1, 2].map(i => Object.prototype.hasOwnProperty.call(q.ov, i) ? slotView(q.ov[i], true) : slotView(q.detected[i], false));
        const left = Math.ceil((q.readyAt - now()) / 1000);
        const title = S.busy ? "Wysy\u0142am:" : left > 0 ? "Wysy\u0142ka za " + left + " s:" : "Czeka na pole wyniku:";
        ui.setStrip({ title, slots, note: "= " + q.total }, onPick);
        return;
      }
      if (S.source === "play") {
        const live = S.playLive;
        if (live && now() - live.ts < 30000 && live.throws && live.throws.length) {
          const darts = live.throws.map(t => Core.normalizeThrow(t)).filter(Boolean);
          ui.setStrip({ title: "Gra:", slots: [0, 1, 2].map(i => slotView(darts[i], false)), note: "= " + darts.reduce((a, d) => a + d.score, 0) }, onPick);
        } else ui.setStrip(null, onPick);
        return;
      }
      const open = tracker.openSlots();
      if (open && open.some(x => x.dart || x.edited)) {
        const darts = tracker.openDarts() || [];
        ui.setStrip({ title: "Tura:", slots: open.map(x => slotView(x.dart, x.edited)), note: "= " + darts.reduce((a, d) => a + d.score, 0) }, onPick);
        return;
      }
      ui.setStrip(null, onPick);
    }
    function onPick(slot, choice) {
      const dart = choice === "auto" ? undefined : choice === "del" ? null : Core.normalizeThrow(choice);
      if (dart && !dart.ok) { log("Z\u0142a warto\u015b\u0107 korekty: " + choice); return; }
      const what = dart === undefined ? "jak AutoDarts" : dart === null ? "usuni\u0119ta" : dart.label;
      const q = S.queue[0];
      if (q) {
        if (S.busy) { log("Za p\u00f3\u017ano na korekt\u0119: tura jest w\u0142a\u015bnie wpisywana"); return; }
        if (dart === undefined) delete q.ov[slot]; else q.ov[slot] = dart;
        q.darts = Core.applyOverrides(q.detected, q.ov);
        q.labels = q.darts.map(d => d.label).join(" ");
        q.total = q.darts.reduce((a, d) => a + d.score, 0);
        q.corrected = Object.keys(q.ov).length > 0;
        if (!q.darts.length) { S.queue.shift(); log("Korekta usun\u0119\u0142a wszystkie lotki: tury nie wpisuj\u0119"); }
        else log("Korekta lotki " + (slot + 1) + ": " + what + " \u2192 tura " + q.labels + " = " + q.total);
      } else if (S.source === "play") {
        log("Tura jeszcze trwa w grze Autodarts: popraw lotk\u0119 w grze (kliknij lotk\u0119 na karcie gry). Wynik p\u00f3jdzie po poprawce.");
      } else if (tracker.setOverride(slot, dart)) {
        const darts = tracker.openDarts() || [];
        log("Korekta lotki " + (slot + 1) + ": " + what + " \u2192 tura " + darts.map(d => d.label).join(" ") + " = " + darts.reduce((a, d) => a + d.score, 0));
      } else {
        log("Brak tury do poprawienia");
      }
      renderStrip();
    }

    function playTabFresh() { return !!(S.playHb && now() - S.playHb.ts < 5000); }
    function playTabText() {
      if (!playTabFresh()) return "BRAK (otw\u00f3rz gr\u0119 X01 na play.autodarts.com w drugiej karcie)";
      const h = S.playHb;
      return h.frames ? "OK, stan meczu odbierany (" + h.path + ")" : "otwarta, ale bez stanu meczu: od\u015bwie\u017c kart\u0119 gry (" + h.path + ")";
    }

    // ----- panel -----
    function refreshPanel() {
      renderStrip();
      const mp = matchPage();
      const t = findTarget();
      S.target = t;
      const apiAge = S.apiOk ? ((now() - S.apiOk) / 1000).toFixed(1) + " s temu" : "nigdy";
      const apiTxt = S.apiErr ? "B\u0141\u0104D: " + S.apiErr : "OK (" + apiAge + ")";
      const st = S.snap;
      const old = document.getElementById("ad2dc-bridge-toggle") || document.getElementById("ad2dc-overlay");
      const rows = [
        ["Wersja", VERSION],
        ["Most", S.enabled ? (S.leader ? "W\u0141\u0104CZONY" : "W\u0141\u0104CZONY, inna karta aktywna") : "WY\u0141\u0104CZONY"],
        ["Strona meczu", mp.text],
        ...(mp.atc ? [["ATC (DartCounter)", (() => { const c = Core.atcDcConfig(atcDcSettings());
          return c.ok ? "1\u219220, bull: " + c.throwout + ", segmenty: " + c.segment + ", trafienia: " + c.hits : "NIEOBS\u0141UGIWANE: " + c.why; })()]] : []),
        ...(S.source === "play" ? [
          ["\u0179r\u00f3d\u0142o", "gra Autodarts (karta play.autodarts)"],
          ["Karta gry", playTabText()],
          ["Lotki w grze", S.playLive && S.playLive.throws && S.playLive.throws.length
            ? S.playLive.throws.map(t => (Core.normalizeThrow(t) || { label: "?" }).label).join(" ") + " (runda " + S.playLive.round + ")" : "-"],
          ["Przekaz", S.listener ? "listener + odpytywanie" : "odpytywanie"]
        ] : [
          ["\u0179r\u00f3d\u0142o", "lokalne: " + S.sourceName],
          ["API " + S.apiBase.replace(/^https?:\/\//, ""), apiTxt],
          ["Stan tarczy", st ? (st.status || "-") + (st.event ? " / " + st.event : "") : "-"],
          ["Lotki teraz", st && st.count ? st.darts.map(d => d.label).join(" ") + " = " + st.darts.reduce((a, d) => a + d.score, 0) : "-"]
        ]),
        ["Ostatnia tura", S.lastVisit ? S.lastVisit.labels + " = " + S.lastVisit.total + " (" + hhmmss(S.lastVisit.ts) + ")" : "-"],
        ["Pole wyniku", t ? "znalezione: " + t.how : "BRAK" + (mp.ok ? " (czekam na Twoj\u0105 kolej)" : "")],
        ["Ostatni wpis", S.lastEntry ? S.lastEntry.score + (S.lastEntry.ok ? " \u2713 " : " \u2717 ") + hhmmss(S.lastEntry.ts) + " (" + S.lastEntry.how + ")" : "-"],
        ["D\u017awi\u0119ki i efekty", S.sounds ? "W\u0141, " + S.soundVolume + "%, " + Sound.state + ", fajerwerki przy 50" : "WY\u0141"],
        ["Wpis", t && t.mode === "darts" ? "lotka po lotce (klawiatura lotek w DartCounter)"
          : t && t.mode === "unsupported" ? "BRAK: " + t.how
          : S.entryMode === "darts" ? "lotka po lotce, ale klawiatura DC: " + keyboardSetting() + " (wpis sumy)" : "suma tury"],
        ["Kolejka", String(S.queue.length) + (S.queue.length && S.waitWhy ? " (czeka: " + S.waitWhy + ")" : "")],
        ["Reset Autodarts", RESET_MODES[S.resetMode] + (S.reset ? " | ostatni: " + hhmmss(S.reset.ts) + " " +
          (S.reset.state === "ok" ? "\u2713 " : S.reset.state === "fail" ? "\u2717 " : "\u2026 ") + S.reset.how : "") +
          (S.autoNext ? " | po wygranym legu: " + hhmmss(S.autoNext.ts) + (S.autoNext.ok ? " \u2713 " : " \u2717 ") + S.autoNext.how : "")],
        ...(S.missed.length ? [["Niewpisane tury", S.missed.map(m => hhmmss(m.ts) + " " + m.labels + ": " + m.why).join(" | ")]] : [])
      ];
      ui.set("rows", rows);
      const kb = keyboardSetting();
      const atcCfg = mp.atc ? Core.atcDcConfig(atcDcSettings()) : null;
      if (atcCfg && atcCfg.throwout !== S.atcDcSent) { S.atcDcSent = atcCfg.throwout; gset(K.atcDc, { throwout: atcCfg.throwout, ts: now() }); } // for the game tab (25 on the bull)
      ui.set("hint", atcCfg && !atcCfg.ok
        ? "Around the Clock: " + atcCfg.why + ". Ustaw w DartCounter: Play from 1 to 20, Finish by hitting the bullseye, bez \u201eIncrease by segment\u201d."
        : mp.atc && atcBoardKeyboard() ? "Around the Clock: wybierz w DartCounter klawiatur\u0119 z przyciskami S/D/T i Miss (klikana tarcza nie jest obs\u0142ugiwana)."
        : mp.atc ? ""
        : !mp.ok
        ? "Uruchom mecz X01: Graj lokalnie \u2192 Mecz (X01) \u2192 Start. Adres meczu: app.dartcounter.net/game/match"
        : t && t.mode === "unsupported"
          ? "Ta klawiatura DartCounter nie jest obs\u0142ugiwana (" + kb + "). Wybierz Single/Double/Treble, numeryczn\u0105 albo pole \u201eWpisz wynik\u201d."
        : S.entryMode === "darts"
          ? (!singleKb() ? "Wpis lotka po lotce: w DartCounter wybierz klawiatur\u0119 pojedynczych lotek (Single/Double/Treble). Teraz: " + kb + "." : "")
          : /^(dartboard|hotkeys|omni)$/.test(kb)
            ? "Klawiatura w DartCounter: " + kb + ". Zmie\u0144 j\u0105 na pole \u201eWpisz wynik\u201d albo klawiatur\u0119 z cyframi."
            : "");
      ui.set("err", old ? "Dzia\u0142a te\u017c stary skrypt AD2DC. Wy\u0142\u0105cz go w mened\u017cerze skrypt\u00f3w." : S.err);
      let dot = "#22c55e", pill = "AD2DC " + VERSION + " \u2713";
      if (!S.enabled) { dot = "#9ca3af"; pill = "AD2DC " + VERSION + " wy\u0142."; }
      else if (S.err || S.missed.length || old || (S.source === "local" && S.apiErr && S.sourceName === "-")) { dot = "#ef4444"; pill = "AD2DC " + VERSION + (S.missed.length ? " niewpisane: " + S.missed.length : " b\u0142\u0105d"); }
      else if (S.source === "play" && !playTabFresh()) { dot = "#f59e0b"; pill = "AD2DC " + VERSION + ": otw\u00f3rz gr\u0119 Autodarts"; }
      else if (!mp.ok) { dot = "#f59e0b"; pill = "AD2DC " + VERSION + ": otw\u00f3rz mecz X01"; }
      else if (atcCfg && !atcCfg.ok) { dot = "#f59e0b"; pill = "AD2DC " + VERSION + ": ATC nieobs\u0142ugiwane"; }
      else if (S.lastEntry) pill = "AD2DC " + VERSION + " \u2713 " + S.lastEntry.score;
      ui.set("dot", dot);
      ui.set("pill", pill);
    }

    function buildReport() {
      const st = S.snap;
      return [
        "AD2DC " + VERSION + " raport " + new Date().toISOString(),
        "mened\u017cer: " + managerName() + " | GM_*: " + hasGM_ + " | GM.*: " + hasGMdot,
        "przegl\u0105darka: " + navigator.userAgent,
        "adres: " + location.href,
        "most: " + (S.enabled ? "ON" : "OFF") + " | aktywna karta: " + S.leader + " | double out: " + S.doubleOut + " | wpis: " + S.entryMode + " | d\u017awi\u0119ki: " + (S.sounds ? S.soundVolume + "% " + Sound.state : "wy\u0142.") + " (z fajerwerkami)",
        "API: " + S.apiBase + " | ok: " + (S.apiOk ? hhmmss(S.apiOk) : "nigdy") + " | b\u0142\u0105d: " + (S.apiErr || "-"),
        "\u017ar\u00f3d\u0142o: " + S.source + " | lokalnie: " + S.sourceName + " | karta gry: " + playTabText() + " | listener: " + S.listener,
        "gra teraz: " + safeJson(S.playLive),
        "stan: " + (st ? st.status + " / " + st.event + " / lotek " + st.count : "-"),
        "pole wyniku: " + (S.target ? S.target.how : "brak") + " | klawiatura DC: " + keyboardSetting(),
        "reszta graczy: " + safeJson(readRemaining()) + " | ostatnio zmieniony: " + S.lastChangedIdx,
        "ostatni wpis: " + safeJson(S.lastEntry),
        "b\u0142\u0105d: " + (S.err || "-"),
        "reset Autodarts: " + RESET_MODES[S.resetMode] + " | ostatni: " + safeJson(S.reset) + " | start: " + S.startScore,
        "niewpisane tury: " + (S.missed.length ? safeJson(S.missed) : "-") + " | kolejka: " + S.queue.length + (S.waitWhy ? " (" + S.waitWhy + ")" : ""),
        "--- log ---",
        ...logBuf.map(x => x.line),
        "--- ostatni stan z lotkami ---",
        safeJson(S.lastRawDarts).slice(0, 3000)
      ].join("\n");
    }
  }

  // =====================================================================
  // Boot
  // =====================================================================
  try {
    if (isDC) startDartCounter();
    else if (isPlay) startPlay();
    else if (isLocal) startRelay();
  } catch (e) {
    console.error(PREFIX, "start error", e);
  }
})();

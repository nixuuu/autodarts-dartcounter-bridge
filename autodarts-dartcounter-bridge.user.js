// ==UserScript==
// @name         AutoDarts -> DartCounter Bridge (debug edition)
// @namespace    https://github.com/nixuuu
// @author       nixuuu
// @version      3.2.0
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
// @connect      *
// ==/UserScript==

/*
 * AD2DC 3.2.0
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
 *
 * Dart correction (3.1.0): the panel shows the darts of the current visit; each one can be changed
 * before the visit is sent (sending happens only after the takeout, optionally after a delay).
 * A correction made in an Autodarts match on play.autodarts goes to the match state in the cloud
 * (game service), not to the local /api/state, so it is not used here.
 */

(function () {
  "use strict";

  const VERSION = "3.2.0";
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
                log("Start w trakcie wyjmowania lotek (" + sig(st.darts) + "). Tej tury nie wysyłam, wpisz ją ręcznie.");
              } else {
                log("Start: na tarczy są już lotki tej tury: " + sig(st.darts));
              }
            }
            return;
          }

          if (st.count === 0) {
            if (visit && !visit.done) finish(visit.pulled ? "lotki wyjęte" : "tarcza pusta");
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
        points: turn ? turn.points : undefined
      };
    }

    // One visit per Autodarts turn, published when the turn is over: the turn key changes
    // (takeout -> next player / next round) or the leg/match is finished. Corrections made
    // before that moment are part of the state, so they are in the visit.
    function createMatchTracker(onVisit, log) {
      log = log || function () {};
      let cur = null;
      const sent = new Set();
      const sig = d => d.map(x => x.label).join(" ");
      function publish(t, reason) {
        if (!t || !t.darts.length) return;
        const id = t.matchId + "/" + t.key;
        if (sent.has(id)) return;
        sent.add(id);
        onVisit({ id, darts: t.darts.slice(0, 3), extraDarts: Math.max(0, t.darts.length - 3), reason, matchId: t.matchId, key: t.key,
          busted: t.busted, points: t.points });
      }
      return {
        current() { return cur; },
        update(m) {
          if (!m) return;
          if (cur && cur.matchId !== m.matchId) { log("Nowy mecz w Autodarts: " + m.matchId); cur = null; }
          if (!cur) {
            cur = m;
            if (m.finished) sent.add(m.matchId + "/" + m.key); // leg already over when we joined
            else if (m.darts.length) log("Start: tura w toku: " + sig(m.darts));
            return;
          }
          if (m.key !== cur.key) {
            if (sent.has(m.matchId + "/" + m.key)) {
              // undo back into a turn that was already sent: send nothing, neither that turn nor the current one
              log("Autodarts wrócił do tury " + m.key + " (cofnięcie). Ta tura już jest w DartCounter. Nic nie wysyłam, popraw DartCounter ręcznie.");
            } else {
              publish(cur, "następna tura");
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

    // Score to enter for a visit.
    // remaining: current player's rest (or null). reliable: true when we are sure it is the current player.
    function decideScore(darts, remaining, reliable, doubleOut) {
      const total = darts.reduce((a, d) => a + d.score, 0);
      if (remaining == null || !(remaining > 0)) return { score: total, total, note: "" };
      let rest = remaining;
      for (const d of darts) {
        rest -= d.score;
        if (rest === 0) {
          if (!doubleOut || d.multiplier === 2) return { score: remaining, total, note: "zakończenie" };
          return { score: 0, total, note: "koniec bez podwójnej = przerzucenie" };
        }
        if (reliable && (rest < 0 || (doubleOut && rest === 1))) return { score: 0, total, note: "przerzucenie (reszta " + remaining + ")" };
        if (rest < 0) break; // not reliable: DartCounter validates busts itself
      }
      return { score: total, total, note: "" };
    }

    return { toNum, parseLabel, normalizeThrow, normalizeState, isPulling, createTracker, decideScore, keyOf, applyOverrides, parseMatch, createMatchTracker };
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
  const K = {
    enabled: "ad2dc3_enabled",
    apiBase: "ad2dc3_api_base",
    panelOpen: "ad2dc3_panel_open",
    doubleOut: "ad2dc3_double_out",
    sendDelay: "ad2dc3_send_delay",
    entryMode: "ad2dc3_entry_mode",
    leader: "ad2dc3_leader",
    lastEntered: "ad2dc3_last_entered",
    relay: "ad2dc3_relay",
    source: "ad2dc3_source",
    playVisits: "ad2dc3_play_visits",
    playLive: "ad2dc3_play_live",
    playHb: "ad2dc3_play_hb",
    enteredIds: "ad2dc3_entered_ids",
    cloud: "ad2dc3_cloud"
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
    } catch (e) { log("BŁĄD odczytu pamięci skryptu: " + errText(e)); }
    return d;
  }
  async function gset(k, v) {
    try {
      if (typeof GM_setValue === "function") return GM_setValue(k, v);
      if (typeof GM !== "undefined" && GM && typeof GM.setValue === "function") return await GM.setValue(k, v);
    } catch (e) { log("BŁĄD zapisu pamięci skryptu: " + errText(e)); }
  }
  function gxhr(url, timeout) {
    return new Promise((resolve, reject) => {
      const d = {
        method: "GET", url, timeout, nocache: true,
        onload: r => resolve({ status: r.status, text: r.responseText }),
        onerror: e => reject(new Error((e && (e.error || e.statusText)) || "brak połączenia")),
        ontimeout: () => reject(new Error("przekroczony czas")),
        onabort: () => reject(new Error("przerwane"))
      };
      try {
        if (typeof GM_xmlhttpRequest === "function") GM_xmlhttpRequest(d);
        else if (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function") {
          const p = GM.xmlHttpRequest(d);
          if (p && typeof p.catch === "function") p.catch(e => reject(e instanceof Error ? e : new Error(errText(e))));
        } else reject(new Error("menedżer skryptów nie ma GM_xmlhttpRequest"));
      } catch (e) { reject(e); }
    });
  }
  function errText(e) {
    if (!e) return "nieznany błąd";
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
    let stripJson = "", pickSlot = null, pickMult = 1, onPick = null;

    function set(k, v) { if (f[k] !== v) { f[k] = v; render(); } }
    function addButton(id, label, fn) { buttons.push({ id, label, fn }); }

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
<div class="pill" id="pill"><span class="dot" id="dot"></span><span id="pilltxt">AD2DC</span></div>
<div class="box" id="box" hidden>
  <div class="row"><b>AD2DC ${VERSION}</b> · ${role} · <span id="mgr"></span></div>
  <div id="rows"></div>
  <div class="hint" id="hint"></div>
  <div class="err" id="err"></div>
  <div class="btns" id="btns"></div>
  <textarea id="manual" hidden readonly></textarea>
  <div class="log" id="log"></div>
</div>
</div>`;
      sh.getElementById("pill").addEventListener("click", () => toggle(true));
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
      const bw = sh.getElementById("btns");
      for (const b of buttons) {
        const el = document.createElement("button");
        el.type = "button"; el.dataset.id = b.id; el.textContent = typeof b.label === "function" ? b.label() : b.label;
        el.addEventListener("click", async ev => { ev.stopPropagation(); try { await b.fn(el); } catch (e) { log("BŁĄD przycisku: " + errText(e)); } render(); });
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
        `<button type="button" class="chip${x && x.edited ? " ed" : ""}" data-slot="${i}" title="Kliknij, żeby poprawić">${esc(x ? x.label : "–")}</button>`).join("") +
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
        `<div class="mrow">${mb(1, "S pojedyncze")}${mb(2, "D podwójne")}${mb(3, "T potrójne")}</div>` +
        `<div class="grid">${nums}</div>` +
        `<div class="xrow"><button type="button" data-x="25">25</button><button type="button" data-x="BULL">Bull 50</button><button type="button" data-x="M">Pudło</button></div>` +
        `<div class="xrow"><button type="button" data-x="auto">Jak AutoDarts</button><button type="button" data-x="del">Usuń lotkę</button><button type="button" data-x="close">Zamknij</button></div>`;
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
        sh.getElementById("box").hidden = !open;
        sh.getElementById("dot").style.background = f.dot || "#9ca3af";
        sh.getElementById("pilltxt").textContent = f.pill || "AD2DC";
        if (!open) return;
        const rows = sh.getElementById("rows");
        const lines = (f.rows || []).map(([k, v]) => `<div class="row"><b>${esc(k)}:</b> ${esc(v)}</div>`).join("");
        if (rows.innerHTML !== lines) rows.innerHTML = lines;
        sh.getElementById("hint").textContent = f.hint || "";
        sh.getElementById("err").textContent = f.err ? "Błąd: " + f.err : "";
        for (const el of sh.getElementById("btns").children) {
          const b = buttons.find(x => x.id === el.dataset.id);
          if (b && typeof b.label === "function") el.textContent = b.label();
        }
        sh.getElementById("log").textContent = logBuf.slice(-CFG.logPanelLines).map(x => x.line).join("\n");
      });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

    return { set, mount, render, addButton, toggle, showManual, setStrip, get open() { return open; } };
  })();

  async function copyWithFeedback(btn, text, okLabel) {
    const ok = await copyText(text);
    if (ok) {
      const old = btn.textContent; btn.textContent = okLabel || "Skopiowano ✓";
      setTimeout(() => { btn.textContent = old; ui.render(); }, 1500);
      log("Skopiowano do schowka (" + text.length + " znaków)");
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
    ui.addButton("close", "Zwiń", () => ui.toggle(false));
    let panelOpenPref = false;
    gget(K.panelOpen, false).then(v => { panelOpenPref = v; });

    (async function loop() {
      for (;;) {
        try {
          const r = await fetch("/api/state", { cache: "no-store" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          lastRaw = await r.json();
          await gset(K.relay, { ts: now(), seq: ++seq, origin: location.origin, raw: lastRaw });
          if (!ok) { ui.mount(panelOpenPref); log("Przekaźnik: /api/state działa na " + location.origin); }
          ok = now(); lastErr = "";
          const st = Core.normalizeState(lastRaw);
          ui.set("dot", "#22c55e");
          ui.set("pill", "AD2DC przekaźnik ✓");
          ui.set("rows", [["/api/state", "OK " + location.origin], ["stan", st ? (st.status || "-") + " / lotek: " + st.count : "-"],
            ["lotki", st && st.count ? st.darts.map(d => d.label).join(" ") : "-"]]);
          ui.set("hint", "Ta karta jest tylko zapasowa. Wynik wpisuje karta DartCounter.");
          ui.set("err", "");
        } catch (e) {
          const m = errText(e);
          if (m !== lastErr) log("Przekaźnik: brak /api/state na " + location.origin + ": " + m);
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
  function startPlay() {
    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const st = { frames: 0, via: {}, last: null, lastTs: 0, lastRaw: null, published: 0, lastVisit: null, hookErr: "" };
    const tracker = Core.createMatchTracker(publishVisit, msg => log(msg));

    ui.addButton("raw", "Kopiuj surowy stan", btn => copyWithFeedback(btn, safeJson(st.lastRaw, true)));
    ui.addButton("copylog", "Kopiuj log", btn => copyWithFeedback(btn, "AD2DC " + VERSION + " (karta gry) " + location.href + "\n" + logBuf.map(x => x.line).join("\n")));
    ui.addButton("close", "Zwiń", () => ui.toggle(false));

    function onFrame(text, via) {
      let m; try { m = JSON.parse(text); } catch (_) { return; }
      if (!m || typeof m !== "object" || !m.data || typeof m.data !== "object") return;
      if (m.channel === "autodarts.boards") { gset(K.cloud, { ts: now(), raw: m.data }); return; } // board state for the local fallback
      if (m.channel !== "autodarts.matches") return;
      const match = Core.parseMatch(m.data);
      if (!match) return;
      st.frames++; st.via[via] = (st.via[via] || 0) + 1;
      if (st.frames === 1) log("Odbieram stan meczu z gry Autodarts (" + via + ")");
      st.last = match; st.lastTs = now(); st.lastRaw = m.data;
      tracker.update(match);
      gset(K.playLive, { ts: now(), matchId: match.matchId, key: match.key, round: match.round, player: match.playerName, variant: match.variant,
        throws: match.darts.map(d => d.raw), finished: match.finished });
      refresh();
    }

    async function publishVisit(v) {
      const item = { id: v.id, ts: now(), reason: v.reason, throws: v.darts.map(d => d.raw), labels: v.darts.map(d => d.label).join(" "),
        busted: v.busted, points: v.points };
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
              log("Podsłuch WebSocket: " + String(url).split("?")[0]);
              ws.addEventListener("message", ev => { if (typeof ev.data === "string") onFrame(ev.data, "unsafeWindow"); });
            }
          } catch (e) { log("BŁĄD podsłuchu: " + errText(e)); }
          return ws;
        };
        Wrapped.prototype = Native.prototype;
        ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => { Wrapped[k] = Native[k]; });
        Wrapped.__ad2dc = true;
        W.WebSocket = Wrapped;
      }
    } catch (e) { st.hookErr = errText(e); log("Podsłuch przez unsafeWindow nie działa: " + st.hookErr); }

    // 2) same hook as a page script (in case unsafeWindow is not the page world); frames come back via postMessage
    window.addEventListener("message", ev => {
      const d = ev.data;
      if (ev.source === window && d && d.__ad2dc === 1 && typeof d.data === "string") onFrame(d.data, "skrypt strony");
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
      const sc = document.createElement("script");
      sc.textContent = code;
      (document.head || document.documentElement).appendChild(sc);
      sc.remove();
    } catch (e) { log("Skrypt strony nie wstrzyknięty: " + errText(e)); }

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
        ["Wysłane tury", String(st.published) + (st.lastVisit ? " (ostatnia: " + st.lastVisit.labels + ")" : "")]
      ]);
      ui.set("hint", st.frames ? "Wynik idzie do DartCounter po zakończeniu tury (wyjęcie lotek / następna tura)."
        : onMatch ? "Nie widzę stanu meczu. Odśwież tę kartę (Cmd+R) i rzuć lotkę." : "Otwórz grę X01 w Autodarts.");
      ui.set("err", m && m.variant && !/x01/i.test(m.variant) ? "To nie jest gra X01 (" + m.variant + ")." : "");
      ui.set("dot", st.frames ? "#22c55e" : onMatch ? "#ef4444" : "#f59e0b");
      ui.set("pill", "AD2DC " + VERSION + (st.frames ? " gra ✓" + (st.published ? " " + st.published : "") : onMatch ? " brak stanu" : " gra"));
    }
  }

  // =====================================================================
  // Role: DartCounter -> poll /api/state, track visits, enter scores
  // =====================================================================
  function startDartCounter() {
    const tabId = Math.random().toString(36).slice(2, 10);
    const S = {
      enabled: true, apiBase: CFG.defaultApiBase, doubleOut: true, sendDelay: 0, source: "play", entryMode: "sum",
      playSeen: null, playLive: null, playHb: null, listener: false,
      leader: false,
      apiOk: 0, apiErr: "", apiFails: 0, lastRaw: null, lastRawDarts: null,
      relayOk: 0, cloudOk: 0, sourceName: "-", snap: null,
      lastVisit: null, lastEntry: null, err: "", busy: false,
      queue: [], target: null,
      rem: [], lastChangedIdx: null
    };

    const tracker = Core.createTracker(onVisit, msg => log(msg));

    // ----- buttons -----
    ui.addButton("toggle", () => (S.enabled ? "Wyłącz most" : "Włącz most"), async () => {
      S.enabled = !S.enabled; await gset(K.enabled, S.enabled);
      if (!S.enabled) S.queue.length = 0;
      tracker.reset();
      log("Most " + (S.enabled ? "WŁĄCZONY" : "WYŁĄCZONY"));
    });
    ui.addButton("source", () => "Źródło: " + (S.source === "play" ? "gra Autodarts" : "lokalne /api/state"), async () => {
      S.source = S.source === "play" ? "local" : "play";
      await gset(K.source, S.source);
      tracker.reset();
      // turns the game tab published before the switch were not for this source: never enter them
      if (S.source === "play") ((await gget(K.playVisits, [])) || []).forEach(x => S.playSeen.add(x.id));
      log("Źródło lotek: " + (S.source === "play" ? "gra X01 na play.autodarts (karta gry)" : "lokalne /api/state (127.0.0.1)"));
    });
    ui.addButton("copylog", "Kopiuj log", btn => copyWithFeedback(btn, buildReport()));
    ui.addButton("raw", "Kopiuj surowy stan", btn => copyWithFeedback(btn,
      "/api/state teraz:\n" + safeJson(S.lastRaw, true) + "\n\nostatni stan z lotkami:\n" + safeJson(S.lastRawDarts, true)));
    ui.addButton("api", "Adres API", async () => {
      const v = prompt("Adres Autodarts (bez /api/state):", S.apiBase);
      if (v && /^https?:\/\/[^/]+$/i.test(v.trim())) { S.apiBase = v.trim(); await gset(K.apiBase, S.apiBase); log("Nowy adres API: " + S.apiBase); }
      else if (v) log("Zły adres: " + v + " (przykład: http://127.0.0.1:3180)");
    });
    ui.addButton("dbl", () => "Double out: " + (S.doubleOut ? "TAK" : "NIE"), async () => {
      S.doubleOut = !S.doubleOut; await gset(K.doubleOut, S.doubleOut); log("Double out: " + (S.doubleOut ? "TAK" : "NIE"));
    });
    ui.addButton("entry", () => "Wpis: " + (S.entryMode === "darts" ? "lotka po lotce" : "suma tury"), async () => {
      S.entryMode = S.entryMode === "darts" ? "sum" : "darts";
      await gset(K.entryMode, S.entryMode);
      log("Sposób wpisu: " + (S.entryMode === "darts" ? "lotka po lotce (klawiatura „single” w DartCounter)" : "suma tury"));
    });
    ui.addButton("delay", () => "Opóźnienie: " + S.sendDelay + " s", async () => {
      const steps = [0, 3, 5, 10];
      S.sendDelay = steps[(steps.indexOf(S.sendDelay) + 1) % steps.length];
      await gset(K.sendDelay, S.sendDelay);
      log("Opóźnienie wysyłki po wyjęciu lotek: " + S.sendDelay + " s");
    });
    ui.addButton("close", "Zwiń", () => ui.toggle(false));

    // ----- boot -----
    (async () => {
      S.enabled = await gget(K.enabled, true);
      S.apiBase = await gget(K.apiBase, CFG.defaultApiBase);
      S.doubleOut = await gget(K.doubleOut, true);
      S.sendDelay = Number(await gget(K.sendDelay, 0)) || 0;
      S.entryMode = (await gget(K.entryMode, "sum")) === "darts" ? "darts" : "sum";
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
    function matchPage() {
      const p = location.pathname;
      if (/^\/game\/match\b/.test(p)) return { ok: true, text: "TAK (mecz X01 lokalny)" };
      if (/^\/(online-game|local-tournament-game)\/match\b/.test(p)) return { ok: true, text: "TAK (mecz X01 online/turniej)" };
      if (/^\/game\//.test(p)) return { ok: false, text: "NIE (to inna gra niż X01: " + p + ")" };
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
    function keyboardSetting() {
      try { return localStorage.getItem("inGameKeyboard") || "(domyślna: none na www)"; } catch (_) { return "?"; }
    }

    const PLACEHOLDER_RE = /wpisz wynik|enter (a )?score|punktzahl|score|wynik|puntuaci|punteggio|pontua|punten|pisteet/i;
    const SUBMIT_RE = /^(wyślij|wyslij|submit|senden|s|ok|enter|envoyer|enviar|invia|verzenden|potwierdź|zatwierdź|absenden)$/i;

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
      if (i) return { mode: "input", input: i, how: "pole z placeholderem i przyciskiem wysyłki" };
      if (hosts.length) return { mode: "keys", host: hosts[0], how: "klawiatura numeryczna (klawisze)" };
      return null;
    }

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
          if (b) { clickedSubmit = true; log("Enter nie zadziałał, klikam przycisk wysyłki"); b.click(); }
        }
      }
      if (score === 0) return { ok: true, how: "0 wysłane (bez zmiany wyniku, nie da się potwierdzić)" };
      return { ok: false, how: "brak zmiany wyniku" };
    }

    // ----- leader election between DartCounter tabs -----
    async function leaderLoop() {
      for (;;) {
        const v = await gget(K.leader, null);
        const t = now();
        const wants = !!findTarget() || matchPage().ok;
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
        if (!S.apiOk || S.apiErr) log("Połączenie z " + S.apiBase + "/api/state OK");
        S.apiOk = now(); S.apiErr = ""; S.apiFails = 0;
        src = "bezpośrednio " + S.apiBase.replace(/^https?:\/\//, "") + "/api/state";
      } catch (e) {
        const m = errText(e);
        S.apiFails++;
        if (m !== S.apiErr) log("Brak połączenia z " + S.apiBase + "/api/state: " + m);
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
      if (src !== S.sourceName) { log("Źródło lotek: " + src); S.sourceName = src; }
      S.lastRaw = raw;
      const st = Core.normalizeState(raw);
      if (!st) return;
      if (st.count) S.lastRawDarts = raw;
      if (st.throwsMissing && !S.warnedMissing) { S.warnedMissing = true; log("API podaje numThrows, ale bez listy lotek. Kliknij „Kopiuj surowy stan” i wyślij."); }
      if (st.unknown && st.count) {
        const sig = st.darts.map(d => d.label).join(" ");
        if (sig !== S.warnedUnknown) { S.warnedUnknown = sig; log("Nie rozumiem formatu lotki. Kliknij „Kopiuj surowy stan” i wyślij.", raw.throws || raw.darts); }
      }
      S.snap = st;
      tracker.update(st, now());
      renderStrip();
    }

    // ----- source "gra": visits published by the play.autodarts game tab -----
    async function playLoop() {
      if (typeof GM_addValueChangeListener === "function") {
        try { GM_addValueChangeListener(K.playVisits, () => { checkPlay(); }); S.listener = true; } catch (e) { log("GM_addValueChangeListener nie działa: " + errText(e)); }
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
        const list = (await gget(K.playVisits, [])) || [];
        for (const item of list) {
          if (!item || S.playSeen.has(item.id)) continue;
          if (!S.leader) continue; // another DartCounter tab enters it (shared id list prevents doubles)
          S.playSeen.add(item.id);
          if (!S.enabled || S.source !== "play") continue; // bridge off or other source: never entered later
          if (now() - item.ts > 60000) { log("Pomijam starą turę z gry: " + item.labels); continue; }
          const darts = (item.throws || []).map(t => { const d = Core.normalizeThrow(t); if (d) d.raw = t; return d; }).filter(Boolean);
          log("Z gry Autodarts: " + item.labels + " (" + item.reason + ", id " + item.id + ")" +
            (item.busted ? " | Autodarts: przerzucenie" : "") + (item.points != null ? " | punkty Autodarts: " + item.points : ""));
          await onVisit({ id: "gra:" + item.id, darts, detected: darts, ov: {}, reason: "gra: " + item.reason, corrected: false });
        }
      } finally { checking = false; }
    }

    // ----- visits -----
    async function onVisit(v) {
      const labels = v.darts.map(d => d.label).join(" ");
      const total = v.darts.reduce((a, d) => a + d.score, 0);
      S.lastVisit = { labels, total, ts: now() };
      log("Tura: " + labels + " = " + total + " (" + v.reason + ")" + (v.extraDarts ? " UWAGA: więcej niż 3 lotki, liczę 3" : ""));
      if (v.darts.some(d => !d.ok)) { setErr("Nie rozpoznano lotki (" + labels + "). Tury nie wpisuję. Kliknij „Kopiuj surowy stan”."); return; }
      if (!S.enabled) { log("Most wyłączony, tury nie wpisuję"); return; }
      if (!v.darts.length) return; // never enter anything without new darts
      const last = await gget(K.lastEntered, null);
      const entered = (await gget(K.enteredIds, [])) || [];
      if (S.queue.some(q => q.id === v.id) || (last && last.id === v.id) || entered.includes(v.id)) { log("Pomijam duplikat wizyty " + v.id); return; }
      // local source only: game visits have a reliable id, identical consecutive visits there are real
      if (!/^gra:/.test(v.id) && last && last.labels === labels && now() - last.ts < CFG.dupWindowMs) { log("Pomijam duplikat tej samej tury (" + labels + ")"); return; }
      S.queue.push({ darts: v.darts, labels, total, ts: now(), id: v.id, detected: v.detected || v.darts, ov: v.ov || {},
        corrected: !!v.corrected, readyAt: now() + S.sendDelay * 1000 });
      if (v.corrected) log("Tura z korektą: AutoDarts " + (v.detected || []).map(d => d.label).join(" ") + " → wysyłam " + labels);
      renderStrip();
    }

    async function queueLoop() {
      let waitingLogged = null;
      for (;;) {
        await sleep(200);
        if (!S.queue.length || S.busy || !S.leader) continue;
        const v = S.queue[0];
        if (now() - v.ts > CFG.visitMaxAgeMs) { S.queue.shift(); setErr("Tura " + v.labels + " czekała za długo, nie wpisana."); continue; }
        if (now() < v.readyAt) { renderStrip(); continue; } // time to correct darts after the takeout
        if (!matchPage().ok && !findTarget()) {
          S.queue.shift();
          setErr("Tura " + v.labels + " nie wpisana: to nie jest strona meczu X01 (" + location.pathname + ")");
          continue;
        }
        if (dialogOpen()) {
          if (waitingLogged !== v.id + "dlg") { waitingLogged = v.id + "dlg"; log("Czekam: DartCounter pyta o lotki. Odpowiedz w oknie."); }
          continue;
        }
        const t = findTarget();
        if (!t) {
          if (waitingLogged !== v.id + "t") { waitingLogged = v.id + "t"; log("Czekam na pole wyniku (np. rzuca DartBot)"); }
          continue;
        }
        S.busy = true; renderStrip();
        try { await enterVisit(v, t); } catch (e) { setErr("Wpis nie wyszedł: " + errText(e)); }
        S.queue.shift();
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
    function singleKb() { return Array.from(document.querySelectorAll("app-single-dart-keyboard")).find(visible) || null; }
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
    function dartButtons(kb, d) {
      const bs = kbButtons(kb);
      if (d.multiplier === 0) return [bs.find(b => b.classList.contains("!uppercase") && !b.hasAttribute("dcbutton"))];
      if (d.number === 25 && d.multiplier === 2) return [bs.find(b => /bull/i.test(btnText(b)) && /50/.test(btnText(b)))];
      if (d.number === 25) return [bs.find(b => /outer/i.test(btnText(b)) && /25/.test(btnText(b)))];
      const mult = bs.find(b => btnText(b).toLowerCase() === ["", "single", "double", "treble"][d.multiplier]);
      const num = bs.find(b => { const n = b.querySelector('[dctypography="bulevar-32"]'); return n && btnText(n) === String(d.number); });
      return [mult, num];
    }
    async function waitFor(fn, ms) {
      const end = now() + ms;
      for (;;) { const r = fn(); if (r) return r; if (now() > end) return null; await sleep(60); }
    }

    // Clicks the darts one by one. Never clicks "Submit" when no dart of this visit is entered.
    async function enterDarts(v) {
      const host0 = scoreHost();
      if (!singleKb() || !host0) return { ok: false, aborted: true, how: "brak klawiatury lotek „single” w DartCounter" };
      const pre = enteredSlots(host0).length;
      if (pre > 0) return { ok: false, aborted: true, how: "w DartCounter są już wpisane lotki tej tury (" + pre + "). Dokończ je ręcznie" };
      const remBefore = readRemaining().join(",");
      let n = 0, stop = "";
      for (const d of v.darts) {
        const kb = singleKb();
        if (!kb) { stop = "tura zakończona przez DartCounter"; break; }
        if (bustConfirm(kb)) { stop = "DartCounter zgłosił przerzucenie"; break; }
        const bs = dartButtons(kb, d);
        if (bs.some(b => !b)) return { ok: false, aborted: true, how: "nie znalazłem przycisku dla " + d.label + " (wpisane lotki: " + n + ")" };
        for (const b of bs) { b.click(); await sleep(40); }
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
        if (!r) return { ok: false, aborted: true, how: "DartCounter nie przyjął lotki " + n + " (" + d.label + ")" };
        if (r === "ok") {
          const got = enteredSlots(scoreHost())[n - 1] || "";
          const exp = expectedSlotLabel(d);
          const fine = exp ? got.replace(/\s+/g, "").toUpperCase() === exp : !/\d/.test(got);
          if (!fine) return { ok: false, aborted: true, how: "lotka " + n + ": DartCounter pokazuje „" + got + "” zamiast " + d.label + ". Popraw ręcznie" };
          log("Lotka " + n + ": " + d.label + " ✓");
        } else { log("Lotka " + n + ": " + d.label + " ✓ (" + (r === "bust" ? "DartCounter: przerzucenie / zła końcówka" : "DartCounter zamknął turę") + ")"); break; }
      }
      if (stop) log("Dalsze lotki pominięte: " + stop);
      const kb = singleKb();
      const confirm = bustConfirm(kb);
      if (confirm) { log("Potwierdzam w DartCounter (przerzucenie / zła końcówka)"); confirm.click(); }
      else if (kb && enteredSlots(scoreHost()).length > 0) {
        const sub = scoreHost().querySelector("button.submit-button");
        if (!sub) return { ok: false, aborted: true, how: "brak przycisku wysyłki tury" };
        sub.click();
      }
      const done = await waitFor(() => {
        if (dialogOpen()) return "DartCounter pyta o lotki (okno)";
        const h = scoreHost(), k = singleKb();
        if (!h || !k) return "kolej przeciwnika";
        if (enteredSlots(h).length === 0 && !bustConfirm(k)) return "tura zatwierdzona";
        return null;
      }, CFG.verifyMs);
      return done ? { ok: true, how: n + " lotk" + (n === 1 ? "a" : n < 5 ? "i" : "ek") + ", " + done } : { ok: false, aborted: true, how: "tura nie została zatwierdzona w DartCounter" };
    }

    async function enterVisit(v, t) {
      if (S.entryMode === "darts") {
        if (singleKb()) {
          await gset(K.lastEntered, { id: v.id, labels: v.labels, ts: now() });
          const entered = (await gget(K.enteredIds, [])) || [];
          entered.push(v.id); while (entered.length > 50) entered.shift();
          await gset(K.enteredIds, entered);
          log("Wpisuję lotka po lotce: " + v.labels + (v.corrected ? " (lotki poprawione ręcznie)" : ""));
          const res = await enterDarts(v);
          S.lastEntry = { score: v.labels, labels: v.labels, ok: res.ok, how: res.how, ts: now() };
          if (res.ok) { log("Wpisano lotki " + v.labels + " ✓ (" + res.how + ")"); S.err = ""; }
          else setErr("Wpis lotek " + v.labels + " przerwany: " + res.how);
          return;
        }
        log("Tryb „lotka po lotce”, ale DartCounter nie ma klawiatury „single” (" + keyboardSetting() + "). Wpisuję sumę tury.");
      }
      const cur = currentRemaining();
      const d = Core.decideScore(v.darts, cur.rem, cur.reliable, S.doubleOut);
      if (d.note) log("Decyzja: " + d.score + " (" + d.note + ")");
      await gset(K.lastEntered, { id: v.id, labels: v.labels, ts: now() });
      const entered = (await gget(K.enteredIds, [])) || [];
      entered.push(v.id); while (entered.length > 50) entered.shift();
      await gset(K.enteredIds, entered);
      log("Wpisuję " + d.score + (v.corrected ? " (lotki poprawione ręcznie: " + v.labels + ")" : "") + " (" + t.how + ")");
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
          log("DartCounter nie przyjął " + d.score + " (przerzucenie, reszta " + cand.join("/") + "). Wpisuję 0 za tę turę.");
          res = await enterAndVerify(t2, 0); score = 0;
        } else {
          log("DartCounter nie przyjął " + d.score + ". Nic więcej nie wpisuję.");
        }
      }
      if (res.ok && score === 0 && cur.idx != null) S.lastChangedIdx = cur.idx;
      S.lastEntry = { score, labels: v.labels, ok: res.ok, how: res.how, ts: now() };
      if (res.ok) { log("Wpisano " + score + " ✓ (" + res.how + ")"); S.err = ""; }
      else setErr("Wpis " + score + " nie zadziałał (" + res.how + "). Klawiatura w DartCounter: " + keyboardSetting());
    }

    function setErr(m) { S.err = m; log("BŁĄD: " + m); }

    // ----- whose turn: remember which player's rest changed last -----
    function watchRemaining() {
      const r = readRemaining();
      if (r.length !== S.rem.length) { S.lastChangedIdx = null; S.rem = r; return; }
      const changed = [];
      for (let i = 0; i < r.length; i++) if (r[i] !== S.rem[i]) changed.push(i);
      if (changed.length === 1) S.lastChangedIdx = changed[0];
      else if (changed.length > 1) S.lastChangedIdx = null;
      S.rem = r;
    }

    // ----- dart correction (strip above the panel) -----
    function slotView(d, edited) {
      return d ? { label: d.label, edited: !!edited, mult: d.multiplier, num: d.number } : (edited ? { label: "✕", edited: true, mult: 1, num: null } : null);
    }
    function renderStrip() {
      if (!S.enabled || !S.leader) { ui.setStrip(null, onPick); return; }
      const q = S.queue[0];
      if (q) {
        const slots = [0, 1, 2].map(i => Object.prototype.hasOwnProperty.call(q.ov, i) ? slotView(q.ov[i], true) : slotView(q.detected[i], false));
        const left = Math.ceil((q.readyAt - now()) / 1000);
        const title = S.busy ? "Wysyłam:" : left > 0 ? "Wysyłka za " + left + " s:" : "Czeka na pole wyniku:";
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
      if (dart && !dart.ok) { log("Zła wartość korekty: " + choice); return; }
      const what = dart === undefined ? "jak AutoDarts" : dart === null ? "usunięta" : dart.label;
      const q = S.queue[0];
      if (q) {
        if (S.busy) { log("Za późno na korektę: tura jest właśnie wpisywana"); return; }
        if (dart === undefined) delete q.ov[slot]; else q.ov[slot] = dart;
        q.darts = Core.applyOverrides(q.detected, q.ov);
        q.labels = q.darts.map(d => d.label).join(" ");
        q.total = q.darts.reduce((a, d) => a + d.score, 0);
        q.corrected = Object.keys(q.ov).length > 0;
        if (!q.darts.length) { S.queue.shift(); log("Korekta usunęła wszystkie lotki: tury nie wpisuję"); }
        else log("Korekta lotki " + (slot + 1) + ": " + what + " → tura " + q.labels + " = " + q.total);
      } else if (S.source === "play") {
        log("Tura jeszcze trwa w grze Autodarts: popraw lotkę w grze (kliknij lotkę na karcie gry). Wynik pójdzie po poprawce.");
      } else if (tracker.setOverride(slot, dart)) {
        const darts = tracker.openDarts() || [];
        log("Korekta lotki " + (slot + 1) + ": " + what + " → tura " + darts.map(d => d.label).join(" ") + " = " + darts.reduce((a, d) => a + d.score, 0));
      } else {
        log("Brak tury do poprawienia");
      }
      renderStrip();
    }

    function playTabFresh() { return !!(S.playHb && now() - S.playHb.ts < 5000); }
    function playTabText() {
      if (!playTabFresh()) return "BRAK (otwórz grę X01 na play.autodarts.com w drugiej karcie)";
      const h = S.playHb;
      return h.frames ? "OK, stan meczu odbierany (" + h.path + ")" : "otwarta, ale bez stanu meczu: odśwież kartę gry (" + h.path + ")";
    }

    // ----- panel -----
    function refreshPanel() {
      renderStrip();
      const mp = matchPage();
      const t = findTarget();
      S.target = t;
      const apiAge = S.apiOk ? ((now() - S.apiOk) / 1000).toFixed(1) + " s temu" : "nigdy";
      const apiTxt = S.apiErr ? "BŁĄD: " + S.apiErr : "OK (" + apiAge + ")";
      const st = S.snap;
      const old = document.getElementById("ad2dc-bridge-toggle") || document.getElementById("ad2dc-overlay");
      const rows = [
        ["Wersja", VERSION],
        ["Most", S.enabled ? (S.leader ? "WŁĄCZONY" : "WŁĄCZONY, inna karta aktywna") : "WYŁĄCZONY"],
        ["Strona meczu", mp.text],
        ...(S.source === "play" ? [
          ["Źródło", "gra Autodarts (karta play.autodarts)"],
          ["Karta gry", playTabText()],
          ["Lotki w grze", S.playLive && S.playLive.throws && S.playLive.throws.length
            ? S.playLive.throws.map(t => (Core.normalizeThrow(t) || { label: "?" }).label).join(" ") + " (runda " + S.playLive.round + ")" : "-"],
          ["Przekaz", S.listener ? "listener + odpytywanie" : "odpytywanie"]
        ] : [
          ["Źródło", "lokalne: " + S.sourceName],
          ["API " + S.apiBase.replace(/^https?:\/\//, ""), apiTxt],
          ["Stan tarczy", st ? (st.status || "-") + (st.event ? " / " + st.event : "") : "-"],
          ["Lotki teraz", st && st.count ? st.darts.map(d => d.label).join(" ") + " = " + st.darts.reduce((a, d) => a + d.score, 0) : "-"]
        ]),
        ["Ostatnia tura", S.lastVisit ? S.lastVisit.labels + " = " + S.lastVisit.total + " (" + hhmmss(S.lastVisit.ts) + ")" : "-"],
        ["Pole wyniku", t ? "znalezione: " + t.how : "BRAK" + (mp.ok ? " (czekam na Twoją kolej)" : "")],
        ["Ostatni wpis", S.lastEntry ? S.lastEntry.score + (S.lastEntry.ok ? " ✓ " : " ✗ ") + hhmmss(S.lastEntry.ts) + " (" + S.lastEntry.how + ")" : "-"],
        ["Wpis", S.entryMode === "darts" ? "lotka po lotce (klawiatura „single”: " + (singleKb() ? "TAK" : "NIE") + ")" : "suma tury"],
        ["Kolejka", String(S.queue.length)]
      ];
      ui.set("rows", rows);
      const kb = keyboardSetting();
      ui.set("hint", !mp.ok
        ? "Uruchom mecz X01: Graj lokalnie → Mecz (X01) → Start. Adres meczu: app.dartcounter.net/game/match"
        : S.entryMode === "darts"
          ? (kb !== "single" ? "Wpis lotka po lotce: w DartCounter wybierz klawiaturę pojedynczych lotek (Single/Double/Treble). Teraz: " + kb + "." : "")
          : /^(single|dartboard|hotkeys|omni)$/.test(kb)
            ? "Klawiatura w DartCounter: " + kb + ". Zmień ją na pole „Wpisz wynik” albo klawiaturę z cyframi."
            : "");
      ui.set("err", old ? "Działa też stary skrypt AD2DC. Wyłącz go w menedżerze skryptów." : S.err);
      let dot = "#22c55e", pill = "AD2DC " + VERSION + " ✓";
      if (!S.enabled) { dot = "#9ca3af"; pill = "AD2DC " + VERSION + " wył."; }
      else if (S.err || old || (S.source === "local" && S.apiErr && S.sourceName === "-")) { dot = "#ef4444"; pill = "AD2DC " + VERSION + " błąd"; }
      else if (S.source === "play" && !playTabFresh()) { dot = "#f59e0b"; pill = "AD2DC " + VERSION + ": otwórz grę Autodarts"; }
      else if (!mp.ok) { dot = "#f59e0b"; pill = "AD2DC " + VERSION + ": otwórz mecz X01"; }
      else if (S.lastEntry) pill = "AD2DC " + VERSION + " ✓ " + S.lastEntry.score;
      ui.set("dot", dot);
      ui.set("pill", pill);
    }

    function buildReport() {
      const st = S.snap;
      return [
        "AD2DC " + VERSION + " raport " + new Date().toISOString(),
        "menedżer: " + managerName() + " | GM_*: " + hasGM_ + " | GM.*: " + hasGMdot,
        "przeglądarka: " + navigator.userAgent,
        "adres: " + location.href,
        "most: " + (S.enabled ? "ON" : "OFF") + " | aktywna karta: " + S.leader + " | double out: " + S.doubleOut + " | wpis: " + S.entryMode,
        "API: " + S.apiBase + " | ok: " + (S.apiOk ? hhmmss(S.apiOk) : "nigdy") + " | błąd: " + (S.apiErr || "-"),
        "źródło: " + S.source + " | lokalnie: " + S.sourceName + " | karta gry: " + playTabText() + " | listener: " + S.listener,
        "gra teraz: " + safeJson(S.playLive),
        "stan: " + (st ? st.status + " / " + st.event + " / lotek " + st.count : "-"),
        "pole wyniku: " + (S.target ? S.target.how : "brak") + " | klawiatura DC: " + keyboardSetting(),
        "reszta graczy: " + safeJson(readRemaining()) + " | ostatnio zmieniony: " + S.lastChangedIdx,
        "ostatni wpis: " + safeJson(S.lastEntry),
        "błąd: " + (S.err || "-"),
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

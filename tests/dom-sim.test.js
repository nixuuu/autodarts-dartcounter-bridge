// Run: npm install && node tests/dom-sim.test.js
// Loads the userscript into a fake DartCounter X01 page (jsdom) and feeds it /api/state snapshots.
// The fake page copies the behaviour found in the DartCounter bundle (app-keyboard-score-input):
//   keyboard "none":    input (input) strips non-digits; keydown key "enter" submits; value reset after submit.
//   keyboard "numbers": keydown on document: digits / Backspace / Enter, ignored when typing in a form field.
//   validation: score <= rest-2 or score == rest (finish), else "impossible" (nothing recorded).
//   while the CPU player throws, <app-keyboard-score-input> is removed.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (n, m) => ({ segmentName: (m === 3 ? "T" : m === 2 ? "D" : m === 0 ? "M" : "S") + n, segmentNumber: n, multiplier: m, bed: m === 0 ? "Outside" : "Single" });

// userscript storage shared by all fake tabs (like Tampermonkey), with optional value-change listeners
function makeStore(withListener) {
  const map = new Map(), listeners = [];
  return {
    map, withListener,
    install(w) {
      w.GM_getValue = (k, d) => (map.has(k) ? JSON.parse(map.get(k)) : d);
      w.GM_setValue = (k, v) => {
        const old = map.get(k); map.set(k, JSON.stringify(v));
        for (const l of listeners) if (l.k === k) setTimeout(() => l.fn(k, old && JSON.parse(old), v, true), 5);
      };
      if (withListener) w.GM_addValueChangeListener = (k, fn) => { listeners.push({ k, fn }); return listeners.length; };
    }
  };
}

function makePage(keyboard, opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body>
    <app-remaining-score id="r0">501</app-remaining-score>
    <app-remaining-score id="r1">501</app-remaining-score>
    <div id="slot"></div></body></html>`,
  { url: "https://app.dartcounter.net/game/match", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest("[hidden]") ? [1] : []; };
  w.localStorage.setItem("inGameKeyboard", keyboard);

  const game = { rest: [501, 501], submitted: [], rejected: [], cur: 0, inputScore: "" };
  const render = () => { doc.getElementById("r0").textContent = String(game.rest[0]); doc.getElementById("r1").textContent = String(game.rest[1]); };
  function submit(score) {
    const r = game.rest[0];
    if (!(score <= 180 && score >= 0 && (score <= r - 2 || score === r))) { game.rejected.push(score); return; }
    game.submitted.push(score);
    game.rest[0] -= score; render();
    // DartBot turn: component removed, bot scores 45, component back
    removeKb();
    setTimeout(() => { game.rest[1] -= 45; render(); addKb(); }, 900);
  }
  let control = "";
  function addKb() {
    const host = doc.createElement("app-keyboard-score-input");
    if (keyboard === "none") {
      host.innerHTML = `<input type="text" inputmode="numeric" maxlength="3" placeholder="Wpisz wynik i naciśnij Enter"><button type="button">Wyślij</button>`;
      const inp = host.querySelector("input");
      inp.addEventListener("input", e => { control = e.target.value.replace(/[^0-9]/g, ""); });
      inp.addEventListener("keydown", e => { if (e.key.toLowerCase() === "enter") { const v = Number(control); control = ""; inp.value = ""; submit(v); } });
    } else {
      host.innerHTML = `<div class="score">${game.inputScore}</div><button type="button">Wyślij</button>`;
    }
    doc.getElementById("slot").appendChild(host);
  }
  function removeKb() { const h = doc.querySelector("app-keyboard-score-input"); if (h) h.remove(); }
  doc.addEventListener("keydown", e => {
    if (keyboard !== "numbers" || !doc.querySelector("app-keyboard-score-input")) return;
    const t = e.target;
    if (t instanceof w.HTMLInputElement || t instanceof w.HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "enter") { const v = game.inputScore === "" ? 0 : Number(game.inputScore); game.inputScore = ""; submit(v); return; }
    if (k === "backspace") { game.inputScore = game.inputScore.slice(0, -1); return; }
    if (/^\d$/.test(e.key) && game.inputScore.length < 3) game.inputScore += e.key;
  });
  addKb();

  // userscript manager stubs
  const store = opts.store || makeStore(false);
  store.install(w);
  if (!store.map.has("ad2dc3_source")) w.GM_setValue("ad2dc3_source", opts.source || "local");
  const api = { state: { status: "throw", event: "takeoutFinished" }, calls: 0 };
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  w.GM_xmlhttpRequest = d => { api.calls++; setTimeout(() => d.onload({ status: 200, responseText: JSON.stringify(api.state) }), 5); };
  w.console.log = () => {};
  w.eval(SCRIPT);
  return { w, doc, game, api, render };
}

async function playVisit(p, darts) {
  const acc = [];
  for (const d of darts) { acc.push(d); p.api.state = { status: "throw", event: "throwDetected", throws: acc.slice() }; await sleep(500); }
  p.api.state = { status: "takeout", event: "throwDetected", throws: acc.slice() }; await sleep(500);
  for (let i = 0; i < 4; i++) { p.api.state = { status: "takeoutInProgress", event: "takeoutStarted", throws: acc.slice() }; await sleep(400); }
  p.api.state = { status: "takeoutInProgress", event: "takeoutStarted" }; await sleep(400);
  p.api.state = { status: "throw", event: "takeoutFinished" };
  await sleep(6500); // bot turn + verification (+ possible 0 for a bust)
}

function makePlayPage(store) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body></body></html>`,
    { url: "https://play.autodarts.com/matches/m1", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getClientRects = function () { return this.isConnected ? [1] : []; };
  class FakeWS extends w.EventTarget { constructor(url) { super(); this.url = url; } emit(obj) { this.dispatchEvent(new w.MessageEvent("message", { data: JSON.stringify(obj) })); } }
  w.WebSocket = FakeWS;
  store.install(w);
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  w.console.log = () => {};
  w.eval(SCRIPT);
  const ws = new w.WebSocket("wss://play.ws.autodarts.com/ms/v0/subscribe?code=x"); // created by the page after our hook
  const P = [{ id: "p1", name: "Player 1" }];
  const seg = (n, m) => ({ segment: { name: (["M", "S", "D", "T"][m]) + n, number: n, multiplier: m, bed: m === 0 ? "Outside" : "Single" } });
  const send = (round, throws, extra) => ws.emit({ type: "event", channel: "autodarts.matches", topic: "m1.state",
    data: Object.assign({ id: "m1", variant: "X01", players: P, player: 0, round, set: 0, leg: 0, turns: [{ round, playerId: "p1", throws }] }, extra || {}) });
  return { w, ws, send, seg };
}

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }

(async () => {
  for (const kb of ["none", "numbers"]) {
    const p = makePage(kb);
    await sleep(1500); // leader election
    // darts left in the board for 6 s (no takeout): nothing may be entered
    p.api.state = { status: "throw", event: "throwDetected", throws: [T(20, 3), T(19, 3), T(18, 3)] }; await sleep(500);
    p.api.state = { status: "takeout", event: "throwDetected", throws: [T(20, 3), T(19, 3), T(18, 3)] }; await sleep(6000);
    check(kb + ": darts left in the board -> nothing entered", p.game.submitted.length === 0 && p.game.rejected.length === 0, p.game);
    p.api.state = { status: "takeoutInProgress", event: "takeoutStarted", throws: [T(20, 3), T(19, 3), T(18, 3)] }; await sleep(800);
    check(kb + ": still nothing while pulling", p.game.submitted.length === 0, p.game);
    p.api.state = { status: "throw", event: "takeoutFinished" }; await sleep(3500);
    check(kb + ": 171 entered once after takeout", JSON.stringify(p.game.submitted) === "[171]", p.game);
    p.game.submitted.length = 0;
    await sleep(1500);
    await playVisit(p, [T(20, 3), T(20, 3), T(20, 3)]);
    check(kb + ": 180 entered once", JSON.stringify(p.game.submitted) === "[180]", p.game);
    await playVisit(p, [T(20, 1), T(1, 1), T(5, 0)]);
    check(kb + ": S20 S1 M5 = 21 entered once", JSON.stringify(p.game.submitted) === "[180,21]", p.game);
    // bust: set rest to 40, throw T20 -> DartCounter rejects 60 -> bridge enters 0
    p.game.rest[0] = 40; p.render(); await sleep(600);
    p.game.rest[1] -= 45; p.render(); await sleep(800); // DartBot threw last -> player 0 is next
    await playVisit(p, [T(20, 3)]);
    check(kb + ": bust 60 on 40 -> rejected, then 0", JSON.stringify(p.game.rejected) === "[60]" && p.game.submitted[2] === 0 && p.game.rest[0] === 40, p.game);
    // correction before takeout: AutoDarts says S4, player fixes it to S18 in the strip
    {
      const sr = p.doc.getElementById("ad2dc-root").shadowRoot;
      const before = p.game.submitted.length;
      p.game.rest[0] = 401; p.render(); await sleep(500);
      p.game.rest[1] -= 45; p.render(); await sleep(800);
      p.api.state = { status: "throw", event: "throwDetected", throws: [T(20, 3), T(4, 1)] }; await sleep(900);
      const chip = sr.querySelector('#strip [data-slot="1"]');
      check(kb + ": strip shows current darts", chip && chip.textContent === "S4" && !sr.getElementById("strip").hidden, chip && chip.textContent);
      chip.click(); await sleep(50);
      sr.querySelector('#picker [data-m="1"]').click(); await sleep(20);
      sr.querySelector('#picker [data-n="18"]').click(); await sleep(50);
      check(kb + ": chip shows correction", sr.querySelector('#strip [data-slot="1"]').textContent === "S18", sr.getElementById("strip").textContent);
      p.api.state = { status: "throw", event: "throwDetected", throws: [T(20, 3), T(4, 1), T(1, 1)] }; await sleep(600);
      p.api.state = { status: "takeoutInProgress", event: "takeoutStarted", throws: [T(20, 3), T(4, 1), T(1, 1)] }; await sleep(600);
      p.api.state = { status: "throw", event: "takeoutFinished" }; await sleep(5500);
      check(kb + ": corrected visit entered once (60+18+1=79)", p.game.submitted.length === before + 1 && p.game.submitted[before] === 79, p.game.submitted);
    }
    // delay 3 s after takeout, correction during the delay
    {
      const sr = p.doc.getElementById("ad2dc-root").shadowRoot;
      sr.querySelector('#btns [data-id="delay"]').click(); await sleep(100); // 0 -> 3 s
      const before = p.game.submitted.length;
      p.api.state = { status: "throw", event: "throwDetected", throws: [T(5, 1), T(5, 1), T(5, 1)] }; await sleep(600);
      p.api.state = { status: "takeoutInProgress", event: "takeoutStarted", throws: [T(5, 1), T(5, 1), T(5, 1)] }; await sleep(600);
      p.api.state = { status: "throw", event: "takeoutFinished" }; await sleep(900);
      check(kb + ": nothing sent during the delay", p.game.submitted.length === before, p.game.submitted);
      const title = sr.querySelector("#strip .t");
      check(kb + ": strip shows countdown", title && /Wysyłka za/.test(title.textContent), title && title.textContent);
      sr.querySelector('#strip [data-slot="0"]').click(); await sleep(50);
      sr.querySelector('#picker [data-m="3"]').click(); await sleep(20);
      sr.querySelector('#picker [data-n="20"]').click(); await sleep(50);
      await sleep(6000);
      check(kb + ": delayed corrected visit entered once (60+5+5=70)", p.game.submitted.length === before + 1 && p.game.submitted[before] === 70, p.game.submitted);
      sr.querySelector('#btns [data-id="delay"]').click(); // 3 -> 5
    }
    const rootShadow = p.doc.getElementById("ad2dc-root");
    check(kb + ": panel mounted and collapsed", rootShadow && rootShadow.shadowRoot.getElementById("box").hidden === true, null);
    check(kb + ": api polled", p.api.calls > 10, p.api.calls);
    p.w.close();
  }
  // ---------- source "gra": play.autodarts game tab -> DartCounter tab ----------
  for (const withListener of [true, false]) {
    const tag = "game (" + (withListener ? "listener" : "polling only") + ")";
    const store = makeStore(withListener);
    const dc = makePage("none", { store, source: "play" });
    const play = makePlayPage(store);
    await sleep(1500);
    const { send, seg } = play;
    send(1, []); await sleep(300);
    send(1, [seg(20, 3)]); await sleep(300);
    send(1, [seg(20, 3), seg(4, 1)]); await sleep(300);
    send(1, [seg(20, 3), seg(18, 1)]); await sleep(300);          // corrected in the game: 4 -> 18
    send(1, [seg(20, 3), seg(18, 1), seg(1, 1)]); await sleep(300);
    dc.api.state = { status: "throw", event: "throwDetected", throws: [T(5, 1)] }; // local source must be ignored
    await sleep(2000);
    check(tag + ": nothing entered while the turn is open", dc.game.submitted.length === 0, dc.game);
    send(2, []); await sleep(200); send(2, []); await sleep(3500);
    check(tag + ": corrected turn entered once (60+18+1=79)", JSON.stringify(dc.game.submitted) === "[79]", dc.game);
    send(2, [seg(20, 1)]); send(2, [seg(20, 1), seg(20, 1), seg(20, 1)]); await sleep(300);
    send(3, []); await sleep(4500);
    check(tag + ": next turn entered once (60)", JSON.stringify(dc.game.submitted) === "[79,60]", dc.game);
    for (let i = 0; i < 5; i++) { send(3, []); await sleep(100); }
    await sleep(1500);
    check(tag + ": repeated frames enter nothing more", dc.game.submitted.length === 2, dc.game);
    send(3, [seg(5, 0), seg(7, 0), seg(9, 0)]); await sleep(300); send(4, []); await sleep(4500);
    check(tag + ": three misses entered as one 0 (real darts)", JSON.stringify(dc.game.submitted) === "[79,60,0]", dc.game);
    const sr = dc.doc.getElementById("ad2dc-root").shadowRoot;
    check(tag + ": pill shows version", /3\.2\.0/.test(sr.getElementById("pilltxt").textContent), sr.getElementById("pilltxt").textContent);
    dc.w.close(); play.w.close();
  }

  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("all DOM simulation checks passed");
  process.exit(0);
})();

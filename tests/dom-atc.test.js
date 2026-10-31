// Run: npm install && node tests/dom-atc.test.js
// 3.5.0 Around the Clock: fake DartCounter ATC page (/game/around-the-clock) + visits from the Autodarts game tab
// (shared userscript storage) and from the local board (/api/state).
// Behaviour copied from the DartCounter bundle (around-the-clock local game):
//   targets 1..20, then bull ("BULL" key when "Finish by hitting the bullseye": counts as multiplier 2 = 50 only);
//   hit keyboard: one row "S7 D7 T7" for the current target (segments "all"), a bull row at the end,
//   last row: undo (icon-key) + Miss; addHit/addMiss push a throw (slot shows value or Miss);
//   submitScore pads the turn with misses, next turn; autoSubmit after 3 darts or when finished; end screen when done.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seg = (n, m) => ({ segment: { name: (["M", "S", "D", "T"][m]) + n, number: n, multiplier: m, bed: m === 0 ? "Outside" : m === 2 ? "Double" : m === 3 ? "Triple" : "SingleInner" } });
const T = (n, m) => ({ segmentName: (["M", "S", "D", "T"][m]) + n, segmentNumber: n, multiplier: m, bed: m === 0 ? "Outside" : "Single" });

function makeStore() {
  const map = new Map();
  return { map, install(w) {
    w.GM_getValue = (k, d) => (map.has(k) ? JSON.parse(map.get(k)) : d);
    w.GM_setValue = (k, v) => { map.set(k, JSON.stringify(v)); };
  } };
}

function makeAtcPage(store, opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body><div id="game"></div></body></html>`,
    { url: "https://app.dartcounter.net/game/around-the-clock", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest("[hidden]") ? [1] : []; };
  w.localStorage.setItem("inGameKeyboard", "numbers");
  w.localStorage.setItem("localAroundTheClockSettings", JSON.stringify(Object.assign(
    { bullOrBullseye: "bullseye", throwOrder: "low_to_high", numberSegment: "all", hit: "once", increaseGoalByMultiplier: false }, opts.dc || {})));
  const g = { at: opts.startAt || 0, throws: [], turns: [], finished: false, clicks: [], alerts: 0, autoSubmit: !!opts.autoSubmit };
  const label = i => (i === 20 ? "BULL" : String(i + 1));
  function addHit(mult) {
    if (g.finished) { g.alerts++; return; }
    if (g.throws.length >= 3) { g.alerts++; return; }
    const isBull = g.at === 20, num = isBull ? 25 : g.at + 1;
    g.throws.push({ number: num, multiplier: mult, value: num * mult });
    g.at++;
    if (g.at > 20) g.finished = true;
    auto();
  }
  function addMiss() {
    if (g.finished) { g.alerts++; return; }
    if (g.throws.length >= 3) { g.alerts++; return; }
    g.throws.push({ number: 0, multiplier: 0, value: 0 });
    auto();
  }
  function auto() { if ((g.throws.length >= 3 || g.finished) && g.autoSubmit) submit(); else render(); }
  function submit() {
    if (!g.finished) while (g.throws.length < 3) g.throws.push({ number: 0, multiplier: 0, value: 0 });
    g.turns.push(g.throws.map(t => (t.multiplier ? (["", "S", "D", "T"][t.multiplier] + t.number) : "Miss")));
    g.throws = [];
    render();
  }
  function render() {
    const root = doc.getElementById("game");
    if (g.finished && !g.throws.length) { root.innerHTML = `<app-around-the-clock-local-end-screen-dialog>Koniec</app-around-the-clock-local-end-screen-dialog>`; return; }
    const slots = g.throws.map(t => `<div class="relative flex"><div class="relative flex w-full flex-col"><div dcTypography="bulevar-40">${t.multiplier ? t.value : "Pudło"}</div></div></div>`).join("");
    // like DartCounter: after the last target only the undo + Miss row stays until the turn is submitted
    const n = label(g.at);
    const keys = `<div class="in-game-keyboard-container">` +
      (g.finished ? "" : g.at < 20 ? `<div class="key-wrapper"><button type="button" class="key" data-k="S"> S${n} </button><button type="button" class="key" data-k="D"> D${n} </button><button type="button" class="key" data-k="T"> T${n} </button></div>`
                 : `<div class="key-wrapper"><button type="button" class="key" data-k="BULL"> ${n} </button></div>`) +
      `<div class="key-wrapper"><button type="button" class="icon-key" data-k="undo"><app-icon icon="undo_outline"></app-icon></button><button type="button" class="key" data-k="miss">Pudło</button></div></div>`;
    root.innerHTML = `<app-around-the-clock-single-dart-input><app-keyboard-score-input><div class="slots">${slots}</div>` +
      `<button type="button" class="submit-button">Wyślij</button></app-keyboard-score-input></app-around-the-clock-single-dart-input>${keys}`;
    root.querySelector(".submit-button").addEventListener("click", () => { g.clicks.push("submit"); submit(); });
    for (const b of root.querySelectorAll("[data-k]")) b.addEventListener("click", () => {
      const k = b.dataset.k; g.clicks.push(k);
      if (k === "S") addHit(1); else if (k === "D") addHit(2); else if (k === "T") addHit(3);
      else if (k === "BULL") addHit(2);            // addThrowout: bullseye -> multiplier 2
      else if (k === "miss") addMiss();
    });
  }
  render();
  store.install(w);
  if (!store.map.has("ad2dc3_source")) w.GM_setValue("ad2dc3_source", opts.source || "play");
  const api = { state: { status: "throw", event: "takeoutFinished" } };
  w.GM_xmlhttpRequest = d => setTimeout(() => (/\/api\/state$/.test(d.url) ? d.onload({ status: 200, responseText: JSON.stringify(api.state) }) : d.onerror({ error: "no" })), 5);
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  g.warns = [];
  w.console.log = () => {};
  w.console.warn = (...a) => { g.warns.push(a); };
  w.eval(SCRIPT);
  return { w, doc, g, api };
}

function publish(store, id, throws, variant, settings, finished) {
  const list = store.map.has("ad2dc3_play_visits") ? JSON.parse(store.map.get("ad2dc3_play_visits")) : [];
  list.push({ id, ts: Date.now(), reason: finished ? "koniec lega/meczu" : "następna tura", throws, labels: "", variant, settings, finished: !!finished });
  store.map.set("ad2dc3_play_visits", JSON.stringify(list));
}
const heartbeat = store => setInterval(() => store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), frames: 1, path: "/matches/a1" })), 400);
const ATC = { order: "1-20-Bull", mode: "Full", hits: 1 };

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }

(async () => {
  for (const autoSubmit of [false, true]) {
    const tag = "ATC (autoSubmit " + (autoSubmit ? "on" : "off") + ")";
    const store = makeStore(), hb = heartbeat(store);
    const p = makeAtcPage(store, { autoSubmit });
    await sleep(1500);
    const sr = p.doc.getElementById("ad2dc-root").shadowRoot;
    sr.getElementById("pill").click(); await sleep(100);
    check(tag + ": panel shows the ATC page and the supported DartCounter settings", /Around the Clock/.test(sr.getElementById("rows").textContent) &&
      /bull: bullseye/.test(sr.getElementById("rows").textContent), sr.getElementById("rows").textContent.slice(0, 200));

    publish(store, "a1/0.0.1.0", [seg(1, 1), seg(2, 3), seg(3, 2)], "ATC", ATC); await sleep(3500);
    check(tag + ": S1 T2 D3 -> three hits on targets 1, 2, 3 (S, T, D keys), next target 4", JSON.stringify(p.g.turns[0]) === '["S1","T2","D3"]' && p.g.at === 3, p.g);
    check(tag + ": submit only when the turn is not auto-submitted", p.g.clicks.filter(c => c === "submit").length === (autoSubmit ? 0 : 1), p.g.clicks);

    publish(store, "a1/0.0.2.0", [seg(4, 1), seg(9, 1), seg(7, 0)], "ATC", ATC); await sleep(3500);
    check(tag + ": S4 S9 miss -> hit, Miss, Miss (wrong number is a miss)", JSON.stringify(p.g.turns[1]) === '["S4","Miss","Miss"]' && p.g.at === 4, p.g.turns);

    publish(store, "a1/0.0.3.0", [seg(5, 3), seg(6, 1)], "ATC", ATC); await sleep(3500);
    check(tag + ": 2-dart turn T5 S6 -> padded with a miss by DartCounter", JSON.stringify(p.g.turns[2]) === '["T5","S6","Miss"]' && p.g.at === 6, p.g.turns);

    clearInterval(hb); p.w.close();
  }

  // full classic finish: target 20 -> S20, 25 (miss with bullseye), 50 (finish) -> end screen
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeAtcPage(store, { startAt: 19 });
    await sleep(1500);
    publish(store, "a2/0.0.1.0", [seg(20, 1), seg(25, 1), seg(25, 2)], "ATC", ATC); await sleep(3500);
    check("ATC finish: S20 hit, outer bull 25 = Miss, bullseye 50 finishes the game", JSON.stringify(p.g.turns[0]) === '["S20","Miss","D25"]' && p.g.finished &&
      !!p.doc.querySelector("app-around-the-clock-local-end-screen-dialog"), p.g);
    check("ATC finish: keys clicked S, miss, BULL, then submit", JSON.stringify(p.g.clicks) === '["S","miss","BULL","submit"]', p.g.clicks);
    check("ATC finish: no errors, no alerts", p.g.alerts === 0 && p.g.warns.length === 0, { alerts: p.g.alerts, warns: p.g.warns });
    publish(store, "a2/0.0.2.0", [seg(1, 1)], "ATC", ATC); await sleep(2000);
    check("ATC finish: nothing more after the end", p.g.turns.length === 1 && p.g.alerts === 0, p.g);
    clearInterval(hb); p.w.close();
  }

  // 3.5.2: Autodarts closes its ATC game on the outer bull (25); DartCounter (bullseye) takes 25 as a miss and plays on
  // -> order to the game tab to start the Autodarts game again; the next darts (50) finish DartCounter
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeAtcPage(store, { startAt: 19 });
    await sleep(1500);
    publish(store, "a3/0.0.1.0", [seg(20, 1), seg(25, 1)], "ATC", ATC, true); await sleep(4500);
    check("ATC: S20 hit, 25 = Miss, DartCounter not finished", JSON.stringify(p.g.turns[0]) === '["S20","Miss","Miss"]' && !p.g.finished, p.g);
    const cmd = store.map.has("ad2dc3_reset_cmd") ? JSON.parse(store.map.get("ad2dc3_reset_cmd")) : null;
    check("ATC: Autodarts finished on 25 -> order to start the Autodarts game again (kind atc)", cmd && cmd.kind === "atc", cmd);
    publish(store, "a3/0.0.1.0~e1", [seg(25, 2)], "ATC", ATC); await sleep(3500);
    check("ATC: after the restart the bullseye finishes DartCounter", p.g.finished && JSON.stringify(p.g.turns[1]) === '["D25"]', p.g.turns);
    clearInterval(hb); p.w.close();
  }

  // Autodarts and DartCounter both finished (bullseye) -> no order
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeAtcPage(store, { startAt: 19 });
    await sleep(1500);
    publish(store, "a4/0.0.1.0", [seg(20, 1), seg(25, 2)], "ATC", ATC, true); await sleep(5000);
    check("ATC: both finished on 50 -> no restart order", p.g.finished && !store.map.has("ad2dc3_reset_cmd"), { g: p.g, cmd: store.map.get("ad2dc3_reset_cmd") });
    clearInterval(hb); p.w.close();
  }

  // setting "off" -> no order
  {
    const store = makeStore(), hb = heartbeat(store);
    store.map.set("ad2dc3_reset_mode", JSON.stringify("off"));
    const p = makeAtcPage(store, { startAt: 19 });
    await sleep(1500);
    publish(store, "a5/0.0.1.0", [seg(20, 1), seg(25, 1)], "ATC", ATC, true); await sleep(5000);
    check("ATC: Reset Autodarts off -> no restart order", !p.g.finished && !store.map.has("ad2dc3_reset_cmd"), store.map.get("ad2dc3_reset_cmd"));
    clearInterval(hb); p.w.close();
  }

  // unsupported or wrong game: nothing clicked, clear error
  const cases = [
    ["Autodarts X01 visit on the DartCounter ATC page", { }, "X01", null, /X01/],
    ["Autodarts order Random-Bull", { }, "ATC", { order: "Random-Bull", mode: "Full", hits: 1 }, /Random-Bull/],
    ["Autodarts order 20-1-Bull", { }, "ATC", { order: "20-1-Bull", mode: "Full", hits: 1 }, /20-1-Bull/],
    ["Autodarts hits 2 vs DartCounter once", { }, "ATC", { order: "1-20-Bull", mode: "Full", hits: 2 }, /trafienia/],
    ["DartCounter order 20 -> 1", { dc: { throwOrder: "high_to_low" } }, "ATC", ATC, /high_to_low/],
    ["DartCounter Increase by segment on", { dc: { increaseGoalByMultiplier: true } }, "ATC", ATC, /Increase by segment/]
  ];
  for (const [name, o, variant, settings, re] of cases) {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeAtcPage(store, o);
    await sleep(1500);
    publish(store, "u/" + name, [seg(1, 1), seg(2, 1), seg(3, 1)], variant, settings); await sleep(2500);
    const msg = p.g.warns.map(x => x[0]).join(" | ");
    check("unsupported: " + name + " -> nothing entered, clear log", p.g.clicks.length === 0 && p.g.turns.length === 0 && re.test(msg), { clicks: p.g.clicks, msg });
    clearInterval(hb); p.w.close();
  }

  // ATC visit while DartCounter has an X01 match open: nothing typed into the X01 score field
  {
    const store = makeStore(), hb = heartbeat(store);
    const dom = new JSDOM(`<!doctype html><html><body><app-remaining-score>501</app-remaining-score><app-keyboard-score-input>` +
      `<input type="text" inputmode="numeric" maxlength="3"><button type="button" class="submit-button">Wyślij</button></app-keyboard-score-input></body></html>`,
      { url: "https://app.dartcounter.net/game/match", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window, typed = [], warns = [];
    w.Element.prototype.getClientRects = function () { return this.isConnected ? [1] : []; };
    w.localStorage.setItem("inGameKeyboard", "none");
    store.install(w); w.GM_setValue("ad2dc3_source", "play");
    w.GM_xmlhttpRequest = d => setTimeout(() => d.onerror({ error: "no" }), 5);
    w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
    w.console.log = () => {}; w.console.warn = (...a) => warns.push(a);
    const inp = w.document.querySelector("input");
    inp.addEventListener("input", e => typed.push(e.target.value));
    w.eval(SCRIPT);
    await sleep(1500);
    publish(store, "x/0.0.1.0", [seg(1, 1), seg(2, 1), seg(3, 1)], "ATC", ATC); await sleep(2500);
    check("X01 match open, Autodarts plays ATC -> nothing typed into X01, clear log", typed.filter(Boolean).length === 0 &&
      /Around the Clock|ATC/.test(warns.map(x => x[0]).join(" ")) && /X01/.test(warns.map(x => x[0]).join(" ")), { typed, warns: warns.map(x => x[0]) });
    clearInterval(hb); w.close();
  }

  // local board (/api/state, no Autodarts game settings): DartCounter decides
  {
    const store = makeStore();
    store.map.set("ad2dc3_source", JSON.stringify("local"));
    const p = makeAtcPage(store, { source: "local" });
    await sleep(1500);
    p.api.state = { status: "throw", event: "throwDetected", throws: [T(1, 1)] }; await sleep(500);
    p.api.state = { status: "throw", event: "throwDetected", throws: [T(1, 1), T(2, 3)] }; await sleep(500);
    p.api.state = { status: "throw", event: "throwDetected", throws: [T(1, 1), T(2, 3), T(19, 1)] }; await sleep(500);
    p.api.state = { status: "takeoutInProgress", event: "takeoutStarted", throws: [T(1, 1), T(2, 3), T(19, 1)] }; await sleep(500);
    p.api.state = { status: "throw", event: "takeoutFinished" }; await sleep(3500);
    check("local board: S1 T2 S19 -> hit, hit, Miss in DartCounter ATC", JSON.stringify(p.g.turns[0]) === '["S1","T2","Miss"]' && p.g.at === 2, p.g);
    p.w.close();
  }

  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("all ATC simulation checks passed");
  process.exit(0);
})();

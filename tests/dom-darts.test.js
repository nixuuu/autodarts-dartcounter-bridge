// Run: npm install && node tests/dom-darts.test.js
// 3.2.0 "Wpis: lotka po lotce": fake DartCounter X01 page with the per-dart keyboard ("single").
// Behaviour copied from the DartCounter bundle (app-single-dart-keyboard + X01 setSingleDart):
//   multiplier buttons "Single"/"Double"/"Treble" (multiplier resets to 1 after each dart), numbers 1-20,
//   "Outer 25" = 25x1, "Bull 50" = 25x2, Miss (class "!uppercase") = 0;
//   per dart: rest < 0 or rest == 1 -> bust (overlay with [dcButton] Confirm, later darts ignored);
//   rest == 0 without a double -> bust (double-out error); rest == 0 on a double -> finish;
//   3rd dart / finish: autoSubmit ? submitted at once : waits for "button.submit-button";
//   Confirm on bust records 0; the per-dart keyboard is removed while the DartBot throws.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seg = (n, m) => ({ segment: { name: (["M", "S", "D", "T"][m]) + n, number: n, multiplier: m, bed: m === 0 ? "Outside" : "Single" } });

function makeStore() {
  const map = new Map(), listeners = [];
  return {
    map,
    install(w) {
      w.GM_getValue = (k, d) => (map.has(k) ? JSON.parse(map.get(k)) : d);
      w.GM_setValue = (k, v) => { map.set(k, JSON.stringify(v)); for (const l of listeners) if (l.k === k) setTimeout(() => l.fn(k, null, v, true), 5); };
      w.GM_addValueChangeListener = (k, fn) => { listeners.push({ k, fn }); return listeners.length; };
    }
  };
}

function makeDC(store, opts) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <app-remaining-score id="r0">501</app-remaining-score><app-remaining-score id="r1">501</app-remaining-score>
    <div id="slot"></div></body></html>`,
  { url: "https://app.dartcounter.net/game/match", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest("[hidden]") ? [1] : []; };
  w.localStorage.setItem("inGameKeyboard", opts.keyboard || "single");
  const g = { rest: [opts.rest || 501, 501], turns: [], darts: [], temp: null, busted: false, mult: 1, autoSubmit: !!opts.autoSubmit, emptySubmits: 0 };
  const render = () => { doc.getElementById("r0").textContent = String(g.rest[0]); doc.getElementById("r1").textContent = String(g.rest[1]); };
  render();

  function record(score, why) {
    g.turns.push({ score, darts: g.darts.map(d => d.label), why });
    if (score > 0) g.rest[0] -= score;
    g.darts = []; g.temp = null; g.busted = false; render();
    remove(); setTimeout(() => { g.rest[1] -= 45; render(); add(); }, 900); // DartBot
  }
  function confirmDarts() {
    if (!g.darts.length) { g.emptySubmits++; return; }
    record(g.darts.reduce((a, d) => a + d.v, 0), "confirm");
  }
  function setDart(amount, mult) {
    if (g.busted || g.temp === 0) return;
    if (g.temp === null) g.temp = g.rest[0];
    const v = amount * mult;
    const label = amount === 0 ? "Miss" : (["", "S", "D", "T"][mult] + amount);
    g.darts.push({ label, v }); g.temp -= v;
    if (g.temp === 0) {
      if (mult !== 2) { g.busted = true; }
      else if (g.autoSubmit) { confirmDarts(); return; }
    } else if (g.temp < 0 || g.temp === 1) g.busted = true;
    else if (g.darts.length === 3 && g.autoSubmit) { confirmDarts(); return; }
    paint();
  }
  let kb, host;
  function paint() {
    host.querySelector(".slots").innerHTML = g.darts.map(d =>
      `<div class="relative flex"><div dcTypography="bulevar-40">${d.v}</div><div dcTypography="geist-12-medium" class="uppercase">${d.label}</div></div>`).join("");
    kb.querySelector(".overlay").innerHTML = g.busted ? `<span>You have bust your score</span><button type="button" dcButton="">Potwierdź</button>` : "";
    const c = kb.querySelector(".overlay button");
    if (c) c.addEventListener("click", () => record(0, "bust"));
    for (const b of kb.querySelectorAll("[data-m]")) b.classList.toggle("selectedMultiplier", Number(b.dataset.m) === g.mult);
  }
  function add() {
    host = doc.createElement("app-keyboard-score-input");
    host.innerHTML = `<div class="slots"></div><button type="button" class="submit-button">Wyślij</button>`;
    host.querySelector(".submit-button").addEventListener("click", confirmDarts);
    kb = doc.createElement("app-single-dart-keyboard");
    let nums = "";
    for (let n = 1; n <= 20; n++) nums += `<button type="button" data-n="${n}"><div dcTypography="bulevar-32">${n}</div></button>`;
    kb.innerHTML = `<div class="overlay"></div>
      <div><button type="button" data-m="1"> Single </button><button type="button" data-m="2"> Double </button><button type="button" data-m="3"> Treble </button>
      <button type="button" data-a="25-2"><div>Bull</div><div>50</div></button><button type="button" data-a="25-1"><div>Outer</div><div>25</div></button></div>
      <div>${nums}</div>
      <div><button type="button" class="undo"><app-icon icon="undo_outline"></app-icon></button><button type="button" class="!uppercase border-x">Pudło</button></div>`;
    for (const b of kb.querySelectorAll("[data-m]")) b.addEventListener("click", () => { g.mult = Number(b.dataset.m); paint(); });
    for (const b of kb.querySelectorAll("[data-n]")) b.addEventListener("click", () => { const m = g.mult; g.mult = 1; setDart(Number(b.dataset.n), m); });
    for (const b of kb.querySelectorAll("[data-a]")) b.addEventListener("click", () => { const [a, m] = b.dataset.a.split("-").map(Number); g.mult = 1; setDart(a, m); });
    kb.querySelector(".\\!uppercase").addEventListener("click", () => { g.mult = 1; setDart(0, 0); });
    doc.getElementById("slot").append(host, kb);
    paint();
  }
  function remove() { if (host) host.remove(); if (kb) kb.remove(); }
  add();

  store.install(w);
  if (!store.map.has("ad2dc3_source")) w.GM_setValue("ad2dc3_source", "play");
  w.GM_setValue("ad2dc3_entry_mode", opts.entry || "darts");
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  w.GM_xmlhttpRequest = d => setTimeout(() => d.onerror({ error: "test: brak API" }), 5);
  w.console.log = () => {};
  w.eval(SCRIPT);
  return { w, doc, g, render };
}

// game tab publishes finished turns into shared storage the same way the play role does
function publish(store, id, throws) {
  const list = store.map.has("ad2dc3_play_visits") ? JSON.parse(store.map.get("ad2dc3_play_visits")) : [];
  list.push({ id, ts: Date.now(), reason: "następna tura", throws, labels: "" });
  store.map.set("ad2dc3_play_visits", JSON.stringify(list));
  store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), frames: 1, path: "/matches/m1" }));
}

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }
const last = g => g.turns[g.turns.length - 1];

(async () => {
  for (const autoSubmit of [false, true]) {
    const tag = "darts (autoSubmit " + (autoSubmit ? "on" : "off") + ")";
    const store = makeStore();
    const p = makeDC(store, { autoSubmit });
    await sleep(1500);
    const hb = setInterval(() => store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), frames: 1, path: "/matches/m1" })), 500);

    publish(store, "m1/0.0.1.0", [seg(20, 3), seg(20, 3), seg(9, 1)]); await sleep(4500);
    check(tag + ": T20 T20 S9 entered as 3 darts, one turn", p.g.turns.length === 1 && JSON.stringify(last(p.g).darts) === '["T20","T20","S9"]' && last(p.g).score === 129, p.g.turns);
    check(tag + ": no empty submit", p.g.emptySubmits === 0, p.g.emptySubmits);

    publish(store, "m1/0.0.2.0", [seg(25, 2), seg(25, 1), seg(7, 0)]); await sleep(4500);
    check(tag + ": Bull, 25, miss", p.g.turns.length === 2 && JSON.stringify(last(p.g).darts) === '["D25","S25","Miss"]' && last(p.g).score === 75, p.g.turns);

    publish(store, "m1/0.0.3.0", [seg(19, 3), seg(18, 2)]); await sleep(4500);
    check(tag + ": 2-dart visit submitted with 2 darts", p.g.turns.length === 3 && JSON.stringify(last(p.g).darts) === '["T19","D18"]', p.g.turns);

    p.g.rest[0] = 40; p.render(); await sleep(500);
    publish(store, "m1/0.0.4.0", [seg(20, 3), seg(1, 1), seg(1, 1)]); await sleep(4500);
    check(tag + ": bust on 40 -> DartCounter bust confirmed (0), later darts ignored", p.g.turns.length === 4 && last(p.g).why === "bust" && last(p.g).score === 0 && JSON.stringify(last(p.g).darts) === '["T20"]' && p.g.rest[0] === 40, p.g.turns);

    publish(store, "m1/0.0.5.0", [seg(20, 1), seg(20, 1)]); await sleep(4500);
    check(tag + ": 40 finished without a double -> bust", p.g.turns.length === 5 && last(p.g).why === "bust" && p.g.rest[0] === 40, p.g.turns);

    publish(store, "m1/0.0.6.0", [seg(20, 1), seg(10, 2)]); await sleep(4500);
    check(tag + ": S20 D10 checkout on 40", p.g.turns.length === 6 && last(p.g).score === 40 && p.g.rest[0] === 0, p.g.turns);

    publish(store, "m1/0.0.6.0", [seg(20, 1), seg(10, 2)]); await sleep(2000);
    check(tag + ": same visit id again -> nothing", p.g.turns.length === 6, p.g.turns.length);
    check(tag + ": still no empty submit", p.g.emptySubmits === 0, p.g.emptySubmits);
    clearInterval(hb); p.w.close();
  }

  // darts mode, but DartCounter keyboard is the text field -> 3.1.0 sum entry is used
  {
    const store = makeStore();
    const dom = makeDC(store, { keyboard: "none" });
    // replace the per-dart keyboard with the text field of keyboard "none"
    for (const el of dom.doc.querySelectorAll("app-single-dart-keyboard")) el.remove();
    const host = dom.doc.querySelector("app-keyboard-score-input");
    host.innerHTML = `<input type="text" inputmode="numeric" maxlength="3"><button type="button" class="submit-button">Wyślij</button>`;
    const inp = host.querySelector("input");
    let control = "";
    inp.addEventListener("input", e => { control = e.target.value.replace(/[^0-9]/g, ""); });
    inp.addEventListener("keydown", e => { if (e.key.toLowerCase() === "enter") { const v = Number(control); control = ""; inp.value = ""; dom.g.turns.push({ score: v, darts: [], why: "sum" }); dom.g.rest[0] -= v; dom.render(); } });
    await sleep(1500);
    store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), frames: 1, path: "/matches/m1" }));
    publish(store, "m1/0.0.1.0", [seg(20, 3), seg(20, 3), seg(9, 1)]); await sleep(4500);
    check("darts mode without keyboard 'single' -> sum 129 entered once", dom.g.turns.length === 1 && dom.g.turns[0].score === 129 && dom.g.turns[0].why === "sum", dom.g.turns);
    dom.w.close();
  }

  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("all per-dart simulation checks passed");
  process.exit(0);
})();

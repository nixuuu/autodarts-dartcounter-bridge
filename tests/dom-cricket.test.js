// Run: npm install && node tests/dom-cricket.test.js
// 3.6.0 Cricket: fake DartCounter "Cricket / Tactics" page (/game/cricket-tactics) + visits from the Autodarts game tab
// (shared userscript storage). Markup as on app.dartcounter.net (captured 2026-11-03):
//   one box per team: .details-wrapper (class "current-turn" for the team on turn) and app-cricket-tactics-team-score
//   with .totalScore (points) and app-in-game-interim-score (legs);
//   app-cricket-tactics-keyboard: keys "20" "D20" "T20" ... "15" "D15" "T15" "SBULL" "BULL" (Tactics also 10-14), keys of a
//   field closed by everybody are disabled, no keys while the DartBot throws;
//   app-cricket-tactics-score-input > app-keyboard-score-input: the entered darts (value + label), "button.submit-button"
//   ends the turn, also with no dart (three misses). A leg is won with every field closed and not fewer points.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const VERSION = /@version\s+(\S+)/.exec(SCRIPT)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (n, m) => ({ id: "t" + Math.random().toString(36).slice(2), segment: { name: (["M", "S", "D", "T"][m]) + n, number: m ? n : 0, multiplier: m, bed: m === 0 ? "Outside" : m === 2 ? "Double" : m === 3 ? "Triple" : "SingleOuter" } });
const B25 = { id: "b25", segment: { name: "25", number: 25, multiplier: 1, bed: "SingleOuter" } };
const B50 = { id: "b50", segment: { name: "Bull", number: 25, multiplier: 2, bed: "Double" } };

function makeStore() {
  const map = new Map();
  return {
    map, get: k => (map.has(k) ? JSON.parse(map.get(k)) : undefined), set: (k, v) => map.set(k, JSON.stringify(v)),
    install(w) {
      w.GM_getValue = (k, d) => (map.has(k) ? JSON.parse(map.get(k)) : d);
      w.GM_setValue = (k, v) => { map.set(k, JSON.stringify(v)); };
    }
  };
}

function makeCricketPage(store, opts) {
  opts = opts || {};
  const dom = new JSDOM(`<!doctype html><html><body><div id="game"></div></body></html>`,
    { url: "https://app.dartcounter.net/game/cricket-tactics", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest("[hidden]") ? [1] : []; };
  w.localStorage.setItem("localCricketTacticsSettings", JSON.stringify(Object.assign({ mode: "cricket", scoring_type: "standard", showCutThroat: true, vsDartBot: true }, opts.dc || {})));
  const tactics = (opts.dc || {}).mode === "tactics";
  const fields = (tactics ? [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10] : [20, 19, 18, 17, 16, 15]).concat([25]);
  const team = name => ({ name, marks: Object.fromEntries(fields.map(f => [f, 0])), points: 0, legs: 0 });
  const g = { teams: [team("guest_test"), team("DartBot")], cur: 0, throws: [], turns: [], clicks: [], cpuPlan: opts.cpuPlan || [], cpuBusy: false, legsLog: [] };
  if (opts.preset) opts.preset(g);
  const closedAll = f => g.teams.every(t => t.marks[f] >= 3);
  function hit(ti, f, m) {
    const t = g.teams[ti], o = g.teams[1 - ti];
    const need = Math.max(0, 3 - t.marks[f]);
    t.marks[f] += m;
    const extra = Math.max(0, m - need);
    if (extra && o.marks[f] < 3) t.points += extra * f;
  }
  function legOver(ti) {
    const t = g.teams[ti], o = g.teams[1 - ti];
    return fields.every(f => t.marks[f] >= 3) && t.points >= o.points;
  }
  function newLeg(winner) {
    g.teams[winner].legs++; g.legsLog.push(winner);
    for (const t of g.teams) { t.points = 0; for (const f of fields) t.marks[f] = 0; }
  }
  function submit() {
    if (g.cur !== 0) return;
    g.turns.push(g.throws.map(x => x.label));
    for (const x of g.throws) hit(0, x.f, x.m);
    g.throws = [];
    if (legOver(0)) { newLeg(0); g.cur = 1; } else g.cur = 1;
    render();
    cpuTurn();
  }
  function cpuTurn() {
    g.cpuBusy = true; render();
    setTimeout(() => {
      const plan = g.cpuPlan.shift() || [];
      for (const [f, m] of plan) hit(1, f, m);
      if (legOver(1)) newLeg(1);
      g.cur = 0; g.cpuBusy = false;
      render();
    }, 400);
  }
  const keyLabel = (f, m) => (f === 25 ? (m === 2 ? "BULL" : "SBULL") : (["", "", "D", "T"][m] + f));
  function render() {
    const root = doc.getElementById("game");
    const boxes = g.teams.map((t, i) => `<div class="player-box"><div class="player-container-user-details"><div class="details-wrapper${g.cur === i ? " current-turn" : ""}"><div appingameplayername> ${t.name} </div></div></div>` +
      `<div class="web-scroll-container"><app-cricket-tactics-team-score><div class="flex"><div dctypography="bulevar-80" class="totalScore"> ${t.points} </div>` +
      `<app-in-game-interim-score orientation="vertical"><div class="flex flex-col"><div appingameinterimscoresize><span appingameinterimscorelabel> ${t.legs} </span></div></div></app-in-game-interim-score>` +
      ` Avg. MPR 0.00</div></app-cricket-tactics-team-score></div></div>`).join("");
    const keys = g.cur === 0 && !g.cpuBusy ? fields.map(f => (f === 25 ? [1, 2] : [1, 2, 3]).map(m =>
      `<button type="button" class="key"${closedAll(f) ? " disabled" : ""} data-f="${f}" data-m="${m}"> ${keyLabel(f, m)} </button>`).join("")).join("") : "";
    const slots = g.throws.map(x => `<div class="relative flex"><div dctypography="bulevar-40"> ${x.f * x.m} </div><div dctypography="geist-12-medium">${x.label}</div></div>`).join("");
    root.innerHTML = `<app-cricket-tactics-local-game><app-cricket-tactics-local-large-layout>${boxes}` +
      `<app-cricket-tactics-score-input><app-keyboard-score-input><div class="slots">${slots}</div><button type="button" class="inline-flex"><app-icon icon="undo_outline"></app-icon></button>` +
      `<button type="button" class="submit-button inline-flex">Submit</button></app-keyboard-score-input></app-cricket-tactics-score-input>` +
      `<app-cricket-tactics-keyboard>${keys}</app-cricket-tactics-keyboard></app-cricket-tactics-local-large-layout></app-cricket-tactics-local-game>`;
    root.querySelector(".submit-button").addEventListener("click", () => { g.clicks.push("submit"); submit(); });
    for (const b of root.querySelectorAll("button.key")) b.addEventListener("click", () => {
      if (b.disabled || g.throws.length >= 3) return;
      const f = Number(b.dataset.f), m = Number(b.dataset.m);
      g.clicks.push(b.textContent.trim());
      g.throws.push({ f, m, label: (f === 25 ? (m === 2 ? "D" : "S") : ["", "S", "D", "T"][m]) + f });
      render();
    });
  }
  render();
  store.install(w);
  if (!store.map.has("ad2dc3_source")) w.GM_setValue("ad2dc3_source", "play");
  w.GM_xmlhttpRequest = d => setTimeout(() => d.onerror({ error: "no" }), 5);
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  g.warns = []; g.logs = [];
  w.console.log = (...a) => g.logs.push(a.join(" "));
  w.console.warn = (...a) => { g.warns.push(a); };
  w.eval(SCRIPT);
  return { w, doc, g };
}

let seq = 0;
function publish(store, throws, settings, finished) {
  const list = store.map.has("ad2dc3_play_visits") ? JSON.parse(store.map.get("ad2dc3_play_visits")) : [];
  list.push({ id: "c1/1.1." + (++seq) + ".0", ts: Date.now(), reason: finished ? "koniec lega/meczu" : "następna tura", throws, labels: "", variant: "Cricket",
    settings: Object.assign({ gameMode: "Cricket", scoringMode: "Standard", players: 1 }, settings || {}), finished: !!finished });
  store.map.set("ad2dc3_play_visits", JSON.stringify(list));
}
// a game tab of this version: heartbeat; answers board orders at once ("received")
const heartbeat = store => setInterval(() => {
  store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), v: VERSION, frames: 1, path: "/matches/c1" }));
  const bc = store.get("ad2dc3_board_cmd"), ba = store.get("ad2dc3_board_ack");
  if (bc && (!ba || ba.id !== bc.id)) store.set("ad2dc3_board_ack", { id: bc.id, ts: Date.now(), state: "received", how: "karta gry odebrała polecenie", v: VERSION });
}, 300);

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info).slice(0, 1200)); } }

(async () => {
  // entry: darts in play, darts not in play (miss), a turn of misses, a field closed by everybody
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeCricketPage(store, { preset: g => { g.teams[1].marks[18] = 3; g.teams[0].marks[17] = 3; g.teams[1].marks[17] = 3; } });
    await sleep(1500);
    const sr = p.doc.getElementById("ad2dc-root").shadowRoot;
    sr.getElementById("pill").click(); await sleep(150);
    check("panel: Cricket page and DartCounter settings", /Cricket \/ Tactics/.test(sr.getElementById("rows").textContent) && /Cricket \(15-20, bull\), punktacja: standard/.test(sr.getElementById("rows").textContent),
      sr.getElementById("rows").textContent.slice(0, 400));
    check("panel: no 'unsupported keyboard' hint on the Cricket page", !/nie jest obs/.test(sr.getElementById("hint").textContent), sr.getElementById("hint").textContent);
    publish(store, [T(20, 3), T(19, 1), T(5, 1)]); await sleep(3000);
    check("T20 S19 S5 -> keys T20 and 19, S5 not in play (miss), turn submitted", JSON.stringify(p.g.turns[0]) === '["T20","S19"]' && JSON.stringify(p.g.clicks.slice(0, 3)) === '["T20","19","submit"]', { turns: p.g.turns, clicks: p.g.clicks });
    publish(store, [T(3, 0), T(7, 1), T(1, 2)]); await sleep(3000);
    check("three darts not in play -> a turn without darts (submit only), DartCounter goes on", JSON.stringify(p.g.turns[1]) === "[]" && p.g.clicks.filter(c => c === "submit").length === 2, { turns: p.g.turns, clicks: p.g.clicks });
    publish(store, [T(18, 3), T(17, 1), B25]); await sleep(3000);
    check("17 closed by everybody (keys disabled): S17 is a miss, T18 and SBULL entered", JSON.stringify(p.g.turns[2]) === '["T18","S25"]' && !p.g.clicks.includes("17"), { turns: p.g.turns, clicks: p.g.clicks });
    publish(store, [B50, T(15, 2)]); await sleep(3000);
    check("BULL and D15", JSON.stringify(p.g.turns[3]) === '["D25","D15"]', p.g.turns);
    check("no errors, no not-entered turns", p.g.warns.length === 0 && !/Niewpisane/.test(sr.getElementById("rows").textContent), { warns: p.g.warns });
    clearInterval(hb); p.w.close();
  }
  // settings that DartCounter cannot follow: other numbers in play, Hidden Cricket
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeCricketPage(store);
    await sleep(1500);
    publish(store, [T(20, 1)], { gameMode: "Tactics" }); await sleep(2000);
    publish(store, [T(20, 1)], { gameMode: "Hidden Cricket" }); await sleep(2000);
    publish(store, [T(20, 1)], { scoringMode: "Cut Throat", players: 2 }); await sleep(2000);
    const sr = p.doc.getElementById("ad2dc-root").shadowRoot;
    sr.getElementById("pill").click(); await sleep(150);
    const rows = sr.getElementById("rows").textContent;
    check("Autodarts Tactics vs DartCounter Cricket -> not entered, clear reason", p.g.turns.length === 0 && /Autodarts gra Tactics, a DartCounter Cricket/.test(rows), rows.slice(-600));
    check("Autodarts Hidden Cricket -> not entered, clear reason", /Hidden Cricket.*nie istnieje w DartCounterze/.test(rows), rows.slice(-600));
    check("Autodarts Cut Throat with 2 players vs DartCounter Standard -> not entered", /Cut Throat.*Standard/.test(rows), rows.slice(-600));
    clearInterval(hb); p.w.close();
  }
  // lost leg: the DartBot closes its last field -> leg end, reset order for Cricket (won = false), board Reset order
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeCricketPage(store, { cpuPlan: [[[20, 1]]], preset: g => { for (const f of [19, 18, 17, 16, 15, 25]) g.teams[1].marks[f] = 3; g.teams[1].marks[20] = 2; } });
    await sleep(1500);
    publish(store, [T(15, 1)]); await sleep(4000);
    const cmd = store.get("ad2dc3_reset_cmd"), bc = store.get("ad2dc3_board_cmd");
    check("lost leg -> DartCounter legs 0/1", JSON.stringify(p.g.legsLog) === "[1]", p.g.legsLog);
    check("lost leg -> reset order for the Autodarts Cricket game, won = false", cmd && cmd.game === "cricket" && cmd.kind === "leg" && cmd.won === false, { cmd, logs: p.g.logs.filter(l => /koniec|Wykryto/.test(l)) });
    check("lost leg -> board Reset order", bc && /przegrany/.test(bc.what) && !bc.manual, bc);
    clearInterval(hb); p.w.close();
  }
  // won leg: our visit closes the last field
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeCricketPage(store, { preset: g => { for (const f of [20, 19, 18, 17, 16, 15]) g.teams[0].marks[f] = 3; g.teams[0].marks[25] = 2; } });
    await sleep(1500);
    publish(store, [B25]); await sleep(4000);
    const cmd = store.get("ad2dc3_reset_cmd");
    check("won leg -> DartCounter legs 1/0, reset order with won = true", JSON.stringify(p.g.legsLog) === "[0]" && cmd && cmd.game === "cricket" && cmd.won === true, { legs: p.g.legsLog, cmd });
    clearInterval(hb); p.w.close();
  }
  // manual board Reset: a well visible button on top of the overlay (and Alt+Shift+R)
  {
    const store = makeStore(), hb = heartbeat(store);
    const p = makeCricketPage(store);
    await sleep(1500);
    const sr = p.doc.getElementById("ad2dc-root").shadowRoot, act = sr.getElementById("act"), msg = sr.getElementById("actmsg");
    check("button 'Reset tarczy' visible with the panel closed", act && !act.hidden && act.textContent === "Reset tarczy" && sr.getElementById("box").hidden, act && act.outerHTML);
    act.click(); await sleep(400);
    let bc = store.get("ad2dc3_board_cmd");
    check("click -> board Reset order for the game tab, at once (manual)", bc && bc.manual === true && bc.what === "reset ręczny", bc);
    await sleep(400);
    check("while it runs the button says 'Reset tarczy…'", act.textContent === "Reset tarczy…" && act.dataset.state === "busy", act.textContent);
    store.set("ad2dc3_board_ack", { id: bc.id, ts: Date.now(), state: "ok", how: "przed: wyjmowanie lotek (Takeout), reset ręczny | lokalnie: POST 127.0.0.1:3180/api/reset → HTTP 200 | po: rzucanie (Throw) | „Dalej” (jak spacja w Autodarts): następna tura, POST /matches/m1/players/next → HTTP 200", v: VERSION });
    await sleep(1200);
    check("result: 'Reset tarczy ✓' on the button", act.textContent === "Reset tarczy ✓" && act.dataset.state === "ok", act.textContent);
    check("green note under the button: board ready + Next", !msg.hidden && msg.dataset.state === "ok" && /^Reset tarczy ✓ tarcza gotowa\. „Dalej”/.test(msg.textContent), msg.outerHTML);
    await sleep(7500);
    check("then back to 'Reset tarczy', note gone", act.textContent === "Reset tarczy" && msg.hidden, { b: act.textContent, m: msg.outerHTML });
    p.doc.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "R", code: "KeyR", altKey: true, shiftKey: true, bubbles: true }));
    await sleep(400);
    const bc2 = store.get("ad2dc3_board_cmd");
    check("Alt+Shift+R -> a new manual board Reset order", bc2 && bc2.id !== bc.id && bc2.manual === true, bc2);
    store.set("ad2dc3_board_ack", { id: bc2.id, ts: Date.now(), state: "fail", how: "przed: brak stanu tarczy (brak po\u0142\u0105czenia), reset ręczny | lokalnie: brak odpowiedzi | chmura: POST /boards/b1/reset → HTTP 401", v: VERSION });
    await sleep(1200);
    check("failed Reset: red button and red note with the reason, red error in the panel", act.dataset.state === "fail" && !msg.hidden && msg.dataset.state === "fail" &&
      /Reset tarczy NIE WYSZED\u0141: .*HTTP 401/.test(msg.textContent) && /R\u0119czny reset tarczy nie wyszed\u0142/.test(p.g.logs.join("\n")), { b: act.textContent, m: msg.textContent });
    // typing in a DartCounter field (ion-input: the real input is in its shadow DOM): no Reset
    const ion = p.doc.createElement("ion-input"); p.doc.body.appendChild(ion);
    const inner = ion.attachShadow({ mode: "open" }).appendChild(p.doc.createElement("input"));
    await sleep(21000);
    inner.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "R", code: "KeyR", altKey: true, shiftKey: true, bubbles: true, composed: true }));
    p.doc.body.appendChild(p.doc.createElement("textarea")).dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "R", code: "KeyR", altKey: true, shiftKey: true, bubbles: true }));
    p.doc.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "r", code: "KeyR", altKey: true, bubbles: true })); // Alt+R alone
    await sleep(400);
    check("Alt+Shift+R inside a text field (ion-input, textarea) or Alt+R alone -> no Reset", store.get("ad2dc3_board_cmd").id === bc2.id, store.get("ad2dc3_board_cmd"));
    clearInterval(hb); p.w.close();
  }

  console.log(failed ? "\n" + failed + " FAILED" : "\nall Cricket checks passed");
  process.exit(failed ? 1 : 0);
})();

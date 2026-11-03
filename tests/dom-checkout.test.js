// Run: npm install && node tests/dom-checkout.test.js
// 3.5.1: DartCounter dialog "Darts used on a double" / "Darts used for checkout" (app-darts-for-throwout-dialog)
// and the end of a DartCounter leg -> reset order for the Autodarts game tab.
// Dialog rules copied from the DartCounter bundle (X01 service checkPossibleCheckoutDarts + possibleDartsOnDouble):
//   shown when the rest before the turn <= 170 (double out) and (rest - score <= 50, a bust (score 0) or a finish);
//   t = fewest darts for that rest; double options: default [0,1,2,3], bust [0,1,2] (t 2) / [0,1] (t 3),
//   finish [1,2,3] / [1,2] (t 2) / [1] (t 3), no finish and rest after <= 50: [0,1] (t 3) / [0,1,2] (t 2);
//   checkout options [1,2,3] / [2,3] (t 2), no dialog for a 3-dart finish (t 3).
//   Buttons: [dcTypography="bulevar-40"] in "flex w-full space-x-4" (double section first), Confirm = [dcButton].
//   setSelectedDart(e): dart = e, atDouble = min(atDouble, e); setSelectedDartAtDouble(e): atDouble = e, dart = max(dart, e).
// The turn is recorded when the dialog is confirmed; a finish starts a new leg (all rests back to 501).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seg = (n, m) => ({ segment: { name: (["M", "S", "D", "T"][m]) + n, number: n, multiplier: m, bed: m === 0 ? "Outside" : "Single" } });
const P = label => { const m = /^([SDTM])(\d+)$/.exec(label); return seg(Number(m[2]), { M: 0, S: 1, D: 2, T: 3 }[m[1]]); };

function makeStore() {
  const map = new Map(), listeners = [];
  return {
    map,
    get: k => (map.has(k) ? JSON.parse(map.get(k)) : undefined),
    set: (k, v) => { map.set(k, JSON.stringify(v)); for (const l of listeners) if (l.k === k) setTimeout(() => l.fn(k, null, v, true), 5); },
    install(w) {
      w.GM_getValue = (k, d) => (map.has(k) ? JSON.parse(map.get(k)) : d);
      w.GM_setValue = (k, v) => { map.set(k, JSON.stringify(v)); for (const l of listeners) if (l.k === k) setTimeout(() => l.fn(k, null, v, true), 5); };
      w.GM_addValueChangeListener = (k, fn) => { listeners.push({ k, fn }); return listeners.length; };
    }
  };
}

function fewestDarts(rest) {
  if (rest === 50 || (rest <= 40 && rest % 2 === 0)) return 1;
  if (rest <= 110) return 2;
  return 3;
}
function dialogOptions(restBefore, score) {
  const r = restBefore - score;
  if (restBefore > 170) return null;
  if (r >= 51 && score > 0) return null;
  const t = fewestDarts(restBefore);
  let i = [0, 1, 2, 3];
  if (score === 0) i = t === 2 ? [0, 1, 2] : t === 3 ? [0, 1] : i;
  else if (r === 0) i = t === 2 ? [1, 2] : t === 3 ? [1] : [1, 2, 3];
  else if (t === 3 && r <= 50) i = [0, 1];
  else if (t === 2 && r <= 50) i = [0, 1, 2];
  let n = [];
  if (r === 0) { if (t === 3) return null; n = t === 2 ? [2, 3] : [1, 2, 3]; }
  return { i, n };
}

// mode "darts": per-dart keyboard (autoSubmit off). mode "sum": score field + Enter.
function makeDC(store, opts) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="board"><app-remaining-score id="r0">501</app-remaining-score><app-remaining-score id="r1">501</app-remaining-score>
    <app-in-game-interim-score id="i0"><div><span>0</span></div></app-in-game-interim-score><app-in-game-interim-score id="i1"><div><span>0</span></div></app-in-game-interim-score></div>
    <div id="slot"></div><div id="dlg"></div></body></html>`,
  { url: "https://app.dartcounter.net/game/match", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, doc = w.document;
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest("[hidden]") ? [1] : []; };
  w.localStorage.setItem("inGameKeyboard", opts.mode === "darts" ? "single" : "numbers");
  const g = { rest: [opts.rest || 501, opts.cpuRest || 501], turns: [], dialogs: [], darts: [], temp: null, busted: false, mult: 1,
    legs: 0, won: [0, 0], cpuTurns: 0, warns: [], rejected: [], logs: [] };
  const render = () => { doc.getElementById("r0").textContent = String(g.rest[0]); doc.getElementById("r1").textContent = String(g.rest[1]); };
  render();

  // new leg: winner's legs + 1, rests back to the start (opts.handicap: start of player 2);
  // opts.gapMs: the scoreboard is gone for a moment between the legs (DartCounter redraw)
  function newLeg(winner) {
    g.legs++; g.won[winner]++;
    const apply = () => {
      g.rest = [501, opts.handicap || 501]; render();
      doc.getElementById("i0").querySelector("span").textContent = String(g.won[0]);
      doc.getElementById("i1").querySelector("span").textContent = String(g.won[1]);
    };
    if (opts.gapMs) { const b = doc.getElementById("board"); b.setAttribute("hidden", ""); setTimeout(() => { apply(); b.removeAttribute("hidden"); }, opts.gapMs); }
    else apply();
  }
  function dartbotTurn() {
    remove();
    setTimeout(() => {
      g.cpuTurns++;
      if (opts.cpuFinishOn && g.cpuTurns === opts.cpuFinishOn) { g.rest[1] = 0; render(); setTimeout(() => { newLeg(1); add(); }, 200); return; }
      g.rest[1] -= 45; render(); add();
    }, 900);
  }
  // our turn is over: maybe the dialog first, the turn is recorded on Confirm
  function turnDone(score, why) {
    const before = g.rest[0];
    const darts = g.darts.map(d => d.label);
    const opt = dialogOptions(before, score);
    remove();
    const finish = before - score === 0;
    const commit = (ans) => {
      g.turns.push({ score, darts, why, ans });
      g.darts = []; g.temp = null; g.busted = false;
      if (finish) { g.rest[0] = 0; render(); newLeg(0); dartbotTurn(); return; }
      g.rest[0] -= score; render(); dartbotTurn();
    };
    if (!opt) { commit(null); return; }
    showDialog(opt, commit);
  }
  function showDialog(opt, commit) {
    const box = doc.createElement("app-darts-for-throwout-dialog");
    const sec = (title, vals, kind) => vals.length ? `<div class="flex flex-col space-y-3"><div dcTypography="bulevar-32"><span>${title}</span></div>` +
      `<div class="flex w-full space-x-4">${vals.map(v => `<button type="button" dcTypography="bulevar-40" data-k="${kind}" data-v="${v}"> ${v} </button>`).join("")}</div></div>` : "";
    box.innerHTML = `<app-center-dialog-layout><div class="flex flex-col space-y-6">${sec("Darts used on a double", opt.i, "d")}${sec("Darts used for checkout", opt.n, "f")}</div>` +
      `<div footer class="dialog-buttons-container"><button type="button" dcButton="" dcBgColor="oche-orange"><span>Confirm</span></button></div></app-center-dialog-layout>`;
    const sel = { dart: opt.n[0], atDouble: opt.i[0] };
    for (const b of box.querySelectorAll("[data-k]")) b.addEventListener("click", () => {
      const v = Number(b.dataset.v);
      if (b.dataset.k === "f") { sel.dart = v; sel.atDouble = Math.min(sel.atDouble, v); }
      else { sel.atDouble = v; if (opt.n.length) sel.dart = Math.max(sel.dart, v); }
    });
    box.querySelector("[dcButton]").addEventListener("click", () => {
      const ans = { dartsAtDouble: sel.atDouble, dartsForCheckout: opt.n.length ? sel.dart : -1, offered: opt };
      g.dialogs.push(ans);
      box.remove();
      setTimeout(() => commit(ans), 30);
    });
    doc.getElementById("dlg").append(box);
  }

  // ----- per-dart keyboard -----
  function setDart(amount, mult) {
    if (g.busted || g.temp === 0) return;
    if (g.temp === null) g.temp = g.rest[0];
    const v = amount * mult;
    g.darts.push({ label: amount === 0 ? "Miss" : (["", "S", "D", "T"][mult] + amount), v }); g.temp -= v;
    if (g.temp === 0 && mult !== 2) g.busted = true;
    else if (g.temp < 0 || g.temp === 1) g.busted = true;
    paint();
  }
  let kb, host;
  function paint() {
    if (opts.mode !== "darts") return;
    host.querySelector(".slots").innerHTML = g.darts.map(d =>
      `<div class="relative flex"><div dcTypography="bulevar-40">${d.v}</div><div dcTypography="geist-12-medium" class="uppercase">${d.label}</div></div>`).join("");
    kb.querySelector(".overlay").innerHTML = g.busted ? `<span>You have bust your score</span><button type="button" dcButton="">Confirm</button>` : "";
    const c = kb.querySelector(".overlay button");
    if (c) c.addEventListener("click", () => turnDone(0, "bust"));
    for (const b of kb.querySelectorAll("[data-m]")) b.classList.toggle("selectedMultiplier", Number(b.dataset.m) === g.mult);
    const row = kb.querySelector(".nums");
    let nums = "";
    for (let n = 1; n <= 20; n++) nums += `<button type="button" data-n="${n}"><div dcTypography="bulevar-32">${n}</div></button>`;
    row.innerHTML = nums;
    for (const b of row.querySelectorAll("[data-n]")) b.addEventListener("click", () => { const m = g.mult; g.mult = 1; setDart(Number(b.dataset.n), m); });
  }
  function add() {
    host = doc.createElement("app-keyboard-score-input");
    if (opts.mode === "darts") {
      host.innerHTML = `<div class="slots"></div><button type="button" class="submit-button">Submit</button>`;
      host.querySelector(".submit-button").addEventListener("click", () => { if (g.darts.length) turnDone(g.darts.reduce((a, d) => a + d.v, 0), "submit"); });
      kb = doc.createElement("app-single-dart-keyboard");
      kb.innerHTML = `<div class="overlay"></div>
        <div><button type="button" data-m="1"> Single </button><button type="button" data-m="2"> Double </button><button type="button" data-m="3"> Treble </button>
        <button type="button" data-a="25-2"><div>Bull</div><div>50</div></button><button type="button" data-a="25-1"><div>Outer</div><div>25</div></button></div>
        <div class="nums"></div>
        <div><button type="button" class="undo"><app-icon icon="undo_outline"></app-icon></button><button type="button" class="!uppercase border-x">Miss</button></div>`;
      for (const b of kb.querySelectorAll("[data-m]")) b.addEventListener("click", () => { g.mult = Number(b.dataset.m); paint(); });
      for (const b of kb.querySelectorAll("[data-a]")) b.addEventListener("click", () => { const [a, m] = b.dataset.a.split("-").map(Number); g.mult = 1; setDart(a, m); });
      kb.querySelector(".\\!uppercase").addEventListener("click", () => { g.mult = 1; setDart(0, 0); });
      doc.getElementById("slot").append(host, kb);
      paint();
    } else {
      host.innerHTML = `<input type="text" inputmode="numeric" maxlength="3" placeholder="Enter a score"><button type="button" class="submit-button">Submit</button>`;
      const inp = host.querySelector("input");
      inp.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const sc = Number(inp.value);
        const rest = g.rest[0];
        // DartCounter: a score above rest - 2 is invalid unless it is the rest itself
        if (!(sc >= 0 && sc <= 180) || (sc > rest - 2 && sc !== rest)) { g.rejected.push(sc); inp.value = ""; return; }
        inp.value = "";
        turnDone(sc, "sum");
      });
      doc.getElementById("slot").append(host);
    }
  }
  function remove() { if (host) host.remove(); if (kb) kb.remove(); }
  add();

  store.install(w);
  if (!store.map.has("ad2dc3_source")) w.GM_setValue("ad2dc3_source", "play");
  w.GM_setValue("ad2dc3_entry_mode", opts.mode === "darts" ? "darts" : "sum");
  if (opts.resetMode) w.GM_setValue("ad2dc3_reset_mode", opts.resetMode);
  if (opts.boardReset === false) w.GM_setValue("ad2dc3_board_reset", false);
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  w.GM_xmlhttpRequest = d => setTimeout(() => d.onerror({ error: "test: brak API" }), 5);
  w.console.log = (...a) => { g.logs.push(a.join(" ")); };
  w.console.warn = (...a) => { g.warns.push(a); };
  w.eval(SCRIPT);
  const panel = () => {
    const sh = doc.getElementById("ad2dc-root").shadowRoot;
    return { rows: sh.getElementById("rows").textContent, err: sh.getElementById("err").textContent, pill: sh.getElementById("pilltxt").textContent };
  };
  const openPanel = () => doc.getElementById("ad2dc-root").shadowRoot.getElementById("pill").click();
  return { w, doc, g, render, add, remove, panel, openPanel };
}

let n = 0;
function publish(store, labels) {
  const list = store.get("ad2dc3_play_visits") || [];
  n++;
  list.push({ id: "m1/0.0." + n + ".0", ts: Date.now(), reason: "następna tura", throws: labels.split(" ").map(P), labels });
  store.map.set("ad2dc3_play_visits", JSON.stringify(list));
}
const VERSION = /@version\s+(\S+)/.exec(SCRIPT)[1];
function heartbeat(store) {
  const beat = () => {
    store.map.set("ad2dc3_play_hb", JSON.stringify({ ts: Date.now(), v: VERSION, frames: 1, path: "/matches/m1" }));
    // a game tab of this version answers a board Reset order at once ("received"); the result comes from the test
    const bc = store.get("ad2dc3_board_cmd"), ba = store.get("ad2dc3_board_ack");
    if (bc && (!ba || ba.id !== bc.id)) store.map.set("ad2dc3_board_ack", JSON.stringify({ id: bc.id, ts: Date.now(), state: "received", how: "karta gry odebra\u0142a polecenie", v: VERSION }));
  };
  beat();
  return setInterval(beat, 400);
}

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }

// one instance: DartBot throws first (so the script knows whose rest is whose), then our visits
async function scenario(mode, rest, visits, opts) {
  const store = makeStore();
  const hb = heartbeat(store);
  const p = makeDC(store, Object.assign({ mode, rest }, opts || {}));
  await sleep(1300);
  p.remove(); p.g.rest[1] -= 45; p.render(); await sleep(500); p.add(); // DartBot opened the leg
  await sleep(500);
  for (const v of visits) { publish(store, v); await sleep(5200); }
  return { p, store, stop: () => clearInterval(hb) };
}

(async () => {
  for (const mode of ["darts", "sum"]) {
    const tag = mode === "darts" ? "per-dart" : "sum";

    // checkout with 1 dart: 40, D20 -> checkout 1, at double 1
    let s = await scenario(mode, 40, ["D20"]);
    let d = s.p.g.dialogs[0];
    check(tag + ": checkout 1 dart (40: D20) -> dialog answered 1 for checkout, 1 at double", d && d.dartsForCheckout === 1 && d.dartsAtDouble === 1, s.p.g.dialogs);
    check(tag + ": checkout 1 dart -> new leg in DartCounter", s.p.g.legs === 1 && s.p.g.turns.length === 1, { legs: s.p.g.legs, turns: s.p.g.turns });
    const cmd = s.store.get("ad2dc3_reset_cmd");
    check(tag + ": won leg -> reset order for the game tab (default: every leg end)", cmd && cmd.kind === "leg" && cmd.won === true, cmd);
    s.stop();

    // checkout with 2 darts: 60, S20 D20 -> 2 / 1
    s = await scenario(mode, 60, ["S20 D20"]);
    d = s.p.g.dialogs[0];
    check(tag + ": checkout 2 darts (60: S20 D20) -> 2 for checkout, 1 at double", d && d.dartsForCheckout === 2 && d.dartsAtDouble === 1, s.p.g.dialogs);
    s.stop();

    // checkout with 3 darts: 100, T20 S20 D10 -> 3 / 2
    s = await scenario(mode, 100, ["T20 S20 D10"]);
    d = s.p.g.dialogs[0];
    check(tag + ": checkout 3 darts (100: T20 S20 D10) -> 3 for checkout, 2 at double", d && d.dartsForCheckout === 3 && d.dartsAtDouble === 2, s.p.g.dialogs);
    s.stop();

    // real bust: 22, S3 S18 -> 0 entered, dialog "darts on double" = 1; the next visit is not blocked
    s = await scenario(mode, 22, ["S3 S18", "S1 S1 S2"]);
    d = s.p.g.dialogs[0];
    check(tag + ": bust (22: S3 S18) -> 0 recorded", s.p.g.turns[0] && s.p.g.turns[0].score === 0, s.p.g.turns);
    check(tag + ": bust -> dialog: 1 dart at double, no checkout darts", d && d.dartsAtDouble === 1 && d.dartsForCheckout === -1, s.p.g.dialogs);
    check(tag + ": next visit after the dialog is entered (queue not blocked)", s.p.g.turns.length === 2 && s.p.g.turns[1].score === 4, s.p.g.turns);
    check(tag + ": nothing missed, no error", !/NIE wpisana/.test(s.p.panel().err) && !s.p.panel().err, s.p.panel());
    check(tag + ": no reset order without a leg end", !s.store.get("ad2dc3_reset_cmd"), s.store.get("ad2dc3_reset_cmd"));
    s.stop();
  }

  // dialog on a non-finishing visit at a low rest: 90, S20 S10 -> rest 60 (t 2, rest after > 50) -> no dialog;
  // 70, S10 S10 -> rest 50: dialog [0,1,2] -> 0 at double (rest 70, 60 are no doubles)
  {
    const s = await scenario("sum", 70, ["S10 S10"]);
    const d = s.p.g.dialogs[0];
    check("sum: no finish, rest 50 after (70: S10 S10) -> dialog answered 0 at double", d && d.dartsAtDouble === 0 && s.p.g.turns[0].score === 20, { d, turns: s.p.g.turns });
    s.stop();
  }

  // a dialog the script cannot relate to its visit (opened by hand): waits, clear message, the visit is entered after
  {
    const store = makeStore();
    const hb = heartbeat(store);
    const p = makeDC(store, { mode: "sum", rest: 501 });
    await sleep(1300);
    p.openPanel();
    const box = p.doc.createElement("app-darts-for-throwout-dialog");
    box.innerHTML = `<div class="flex w-full space-x-4"><button type="button" dcTypography="bulevar-40">0</button></div><button type="button" dcButton="">Confirm</button>`;
    box.querySelector("[dcButton]").addEventListener("click", () => box.remove());
    p.doc.getElementById("dlg").append(box);
    publish(store, "S20 S20 S20");
    await sleep(2500);
    check("foreign dialog: visit waits, clear panel message", p.g.turns.length === 0 && /pyta o lotki/.test(p.panel().err), p.panel());
    box.querySelector("[dcButton]").click();
    await sleep(4000);
    check("foreign dialog closed by the player -> waiting visit entered", p.g.turns.length === 1 && p.g.turns[0].score === 60, p.g.turns);
    clearInterval(hb);
  }

  // lost leg: DartBot checks out -> reset order with won = false; setting "only after a lost leg"
  {
    const s = await scenario("sum", 501, ["S20 S20 S20"], { cpuRest: 100, cpuFinishOn: 1, resetMode: "lost" });
    await sleep(2500);
    const cmd = s.store.get("ad2dc3_reset_cmd");
    check("lost leg (DartBot checkout) -> reset order, won = false", cmd && cmd.kind === "leg" && cmd.won === false, cmd);
    // 3.5.6: board Reset after the leg (default on), done by the game tab: it answers at once
    const bc = s.store.get("ad2dc3_board_cmd");
    check("lost leg -> board Reset order for the game tab (with the Board Manager address)", bc && /przegrany/.test(bc.what) && bc.base === "http://127.0.0.1:3180" && bc.v === VERSION, bc);
    if (bc) s.store.set("ad2dc3_board_ack", { id: bc.id, ts: Date.now(), state: "ok", how: "lokalnie: POST 127.0.0.1:3180/api/reset \u2192 HTTP 200", v: VERSION });
    // game tab answers: ok
    s.store.set("ad2dc3_reset_ack", { id: cmd.id, ts: Date.now(), state: "ok", how: "leg od nowa (games/restart)" });
    await sleep(1200);
    s.p.openPanel();
    await sleep(700);
    check("reset ack ok -> panel row with the result", /Reset Autodarts.*✓ leg od nowa/.test(s.p.panel().rows), s.p.panel().rows);
    check("board ack ok -> panel row 'Reset tarczy' with the result", /Reset tarczy.*po ka\u017cdym legu \(X01, Cricket\).*\u2713 karta gry: lokalnie: POST 127\.0\.0\.1:3180\/api\/reset/.test(s.p.panel().rows), s.p.panel().rows);
    s.stop();
  }
  // board Reset switched off -> no order
  {
    const s = await scenario("sum", 501, ["S20 S20 S20"], { cpuRest: 100, cpuFinishOn: 1, boardReset: false });
    await sleep(2500);
    check("board Reset off -> leg end gives no board order (reset order of Autodarts still sent)", !s.store.get("ad2dc3_board_cmd") && !!s.store.get("ad2dc3_reset_cmd"),
      { board: s.store.get("ad2dc3_board_cmd"), reset: s.store.get("ad2dc3_reset_cmd") });
    s.stop();
  }

  // won leg with "only after a lost leg" -> no order
  {
    const s = await scenario("sum", 40, ["D20"], { resetMode: "lost" });
    check("won leg + setting 'only after a lost leg' -> no reset order", !s.store.get("ad2dc3_reset_cmd") && s.p.g.legs === 1, s.store.get("ad2dc3_reset_cmd"));
    s.stop();
  }

  // setting "off" -> never
  {
    const s = await scenario("sum", 40, ["D20"], { resetMode: "off" });
    check("setting off -> no reset order", !s.store.get("ad2dc3_reset_cmd"), s.store.get("ad2dc3_reset_cmd"));
    s.stop();
  }

  // match end screen with setting "match end"; a leg end before it gives no order
  {
    const s = await scenario("sum", 40, ["D20"], { resetMode: "match" });
    check("setting 'match end': leg end -> no order", !s.store.get("ad2dc3_reset_cmd"), s.store.get("ad2dc3_reset_cmd"));
    await sleep(5200);
    const es = s.p.doc.createElement("app-match-local-end-screen-dialog");
    es.textContent = "Match over";
    s.p.doc.body.append(es);
    await sleep(2500);
    const cmd = s.store.get("ad2dc3_reset_cmd");
    check("match end screen -> reset order kind 'match'", cmd && cmd.kind === "match", cmd);
    // 3.5.5: no answer from the game tab -> the same order again after 3 s and 6 s, then a clear error (alive, same version)
    await sleep(4000);
    check("no answer within 3 s -> the same order sent again (attempt 2)", (s.store.get("ad2dc3_reset_cmd") || {}).id === cmd.id && s.store.get("ad2dc3_reset_cmd").attempt === 2, s.store.get("ad2dc3_reset_cmd"));
    await sleep(6000);
    s.p.openPanel(); await sleep(600);
    check("no game tab answer after 3 tries -> clear error", (s.store.get("ad2dc3_reset_cmd") || {}).attempt === 3 &&
      /karta gry nie odebra\u0142a polecenia po 3 pr\u00f3bach.*od\u015bwie\u017c j\u0105/.test(s.p.panel().err), { err: s.p.panel().err, cmd: s.store.get("ad2dc3_reset_cmd") });
    s.stop();
  }

  // reset fails in the game tab -> clear error, later visits still entered
  {
    const s = await scenario("sum", 40, ["D20"]);
    const cmd = s.store.get("ad2dc3_reset_cmd");
    s.store.set("ad2dc3_reset_ack", { id: cmd.id, ts: Date.now(), state: "fail", how: "brak tokenu logowania Autodarts" });
    await sleep(1500);
    s.p.openPanel(); await sleep(600);
    check("reset failed -> clear error with what to do", /Reset Autodarts nie wyszedł: brak tokenu.*ręcznie/.test(s.p.panel().err), s.p.panel());
    await sleep(2000);
    publish(s.store, "T20 T20 T20");
    await sleep(5000);
    check("after a failed reset the next visit is entered", s.p.g.turns.length === 2 && s.p.g.turns[1].score === 180, s.p.g.turns);
    s.stop();
  }

  // 3.5.2: lost leg while DartCounter redraws the scoreboard between legs (scores gone for a moment)
  {
    const s = await scenario("sum", 501, ["S20 S20 S20"], { cpuRest: 100, cpuFinishOn: 1, gapMs: 900 });
    await sleep(2500);
    const cmd = s.store.get("ad2dc3_reset_cmd");
    check("lost leg, scoreboard gone for 0.9 s between legs -> reset order, won = false", cmd && cmd.kind === "leg" && cmd.won === false, cmd);
    check("diagnostic log: leg end detected + reason won/lost + order", s.p.g.logs.some(l => /Wykryto koniec lega/.test(l)) &&
      s.p.g.logs.some(l => /koniec lega \(przegrany\).*bez zako\u0144czenia/.test(l)) && s.p.g.logs.some(l => /polecenie .* do karty gry/.test(l)),
      s.p.g.logs.filter(l => /lega|Reset/.test(l)));
    s.stop();
  }

  // 3.5.2: handicap (rests not equal at the new leg) -> the legs counter still shows the leg end
  {
    const s = await scenario("sum", 501, ["S20 S20 S20"], { cpuRest: 100, cpuFinishOn: 1, handicap: 301 });
    await sleep(2500);
    const cmd = s.store.get("ad2dc3_reset_cmd");
    check("lost leg with a handicap start (501/301) -> legs counter gives the leg end, reset order", cmd && cmd.won === false, { cmd, logs: s.p.g.logs.filter(l => /leg/i.test(l)) });
    s.stop();
  }

  // undo in DartCounter (one rest goes up) is no leg end
  {
    const store = makeStore();
    const hb = heartbeat(store);
    const p = makeDC(store, { mode: "sum", rest: 100 });
    await sleep(1300);
    p.g.rest = [100, 60]; p.render(); await sleep(900);
    p.g.rest = [100, 100]; p.render(); await sleep(2500);
    check("undo to equal rests (100/100) -> no leg end, no reset order", !store.get("ad2dc3_reset_cmd"), store.get("ad2dc3_reset_cmd"));
    clearInterval(hb);
  }

  // a visit that cannot be entered is listed, never dropped silently
  {
    const store = makeStore();
    const hb = heartbeat(store);
    const dom = makeDC(store, { mode: "sum", rest: 501 });
    await sleep(1300);
    dom.openPanel();
    dom.w.history.pushState({}, "", "/dashboard");
    dom.remove();
    publish(store, "S5 S5 S5");
    await sleep(2500);
    const pn = dom.panel();
    check("visit on a non-match page -> listed as not entered (panel row + red pill)", /Niewpisane tury/.test(pn.rows) && /S5 S5 S5/.test(pn.rows) && /niewpisane: 1/.test(pn.pill), pn);
    clearInterval(hb);
  }

  console.log(failed ? "\n" + failed + " FAILED" : "\nall checkout / reset checks passed");
  process.exit(failed ? 1 : 0);
})();

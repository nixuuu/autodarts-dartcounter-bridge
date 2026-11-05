// Run: npm install && node tests/dom-play-reset.test.js
// 3.5.1: the Autodarts game tab (play.autodarts.com) gets a reset order from the DartCounter tab.
// Fake page: a WebSocket that the script hooks (match state frames, channel autodarts.matches) and a fake
// page helper that answers the script's API requests (in the real page the injected helper calls api.autodarts.com).
// Plan, like the Autodarts Next button: leg over -> POST games/next; match over -> new match from the old one;
// leg in progress (3.5.5) -> the app's own Undo back to the start of the leg, else POST games/restart, else a new match
// (from-match, DELETE old, start). Answers: "received" at once, "busy" with the API steps, then "ok" / "fail".
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (n, m) => ({ segment: { name: (["M", "S", "D", "T"][m]) + n, number: n, multiplier: m, bed: m ? "Single" : "Outside" } });

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

// state like the Autodarts game server sends it
function state(o) {
  return Object.assign({ id: "m1", variant: "X01", settings: { baseScore: 501, inMode: "Straight", outMode: "Double" }, players: [{ id: "p1", name: "Ja" }],
    player: 0, round: 1, set: 0, leg: 0, finished: false, gameFinished: false, gameScores: [501], turns: [{ round: 1, playerId: "p1", throws: [] }] }, o);
}

function makePlay(store, api, onCmd, opt) {
  const vc = new VirtualConsole();
  const nav = [];
  vc.on("jsdomError", e => { if (/navigation/.test(e.message)) nav.push(e.message); else console.error(e); }); // location.assign to the new match
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`,
    { url: "https://play.autodarts.com/matches/m1", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.getClientRects = function () { return this.isConnected ? [1] : []; };
  class FakeWS extends w.EventTarget { constructor(url) { super(); this.url = url; } }
  w.WebSocket = FakeWS;
  const calls = [], logs = [];
  // fake page helper: the script posts { __ad2dcCmd, rid, method, path }, the answer comes back from the page (source = window)
  w.addEventListener("message", ev => {
    const d = ev.data;
    if (!d || d.__ad2dcCmd !== 1) return;
    calls.push(d.method + " " + d.path);
    if (onCmd) onCmd(d);
    Promise.resolve(api(d.method, d.path, d.body)).then(res => {
      setTimeout(() => w.dispatchEvent(new w.MessageEvent("message", { data: Object.assign({ __ad2dcRes: 1, rid: d.rid }, res),
        source: opt && "source" in opt ? opt.source : w, origin: "https://play.autodarts.com" })), 20);
    });
  });
  store.install(w);
  w.GM_info = { scriptHandler: "FakeMonkey", version: "1" };
  w.GM_xmlhttpRequest = d => setTimeout(() => d.onerror({ error: "no" }), 5);
  w.console.log = (...a) => logs.push(a.join(" "));
  w.console.warn = () => {};
  w.eval(SCRIPT);
  const ws = new w.WebSocket("wss://play.ws.autodarts.com/ms/v0/subscribe");
  const send = s => ws.dispatchEvent(new w.MessageEvent("message", { data: JSON.stringify({ channel: "autodarts.matches", topic: s.id + ".state", data: s }) }));
  const sendBoard = b => ws.dispatchEvent(new w.MessageEvent("message", { data: JSON.stringify({ channel: "autodarts.boards", topic: "b.state", data: b }) }));
  return { w, calls, logs, send, sendBoard, nav };
}
// the DartCounter tab plays Around the Clock with the bridge on (its heartbeat), needed for the automatic ATC restart
const dcAtc = store => { const beat = () => store.set("ad2dc3_dc_hb", { ts: Date.now(), v: "3.5.5", path: "/game/around-the-clock", enabled: true }); beat(); return setInterval(beat, 500); };
const order = (store, kind) => store.set("ad2dc3_reset_cmd", { id: "dc-" + Math.random().toString(36).slice(2), ts: Date.now(), kind: kind || "leg", won: false });
const ack = store => store.get("ad2dc3_reset_ack") || {};
const visits = store => store.get("ad2dc3_play_visits") || [];

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }

(async () => {
  // 1) leg in progress -> Undo (one dart or one change of turn per call, like the app) back to the start of the leg;
  //    the turns shown again while rewinding are not sent; the restarted leg repeats turn keys, its visits still go out
  {
    const store = makeStore();
    let pg;
    const history = []; // states before each action, like the server's undo
    const play = s => { history.push(pg.lastState); pg.lastState = s; pg.send(s); };
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") {
        if (!history.length || history[history.length - 1] === undefined) return { ok: false, status: 400, err: "HTTP 400 nothing to undo" };
        const prev = history.pop(); pg.lastState = prev; setTimeout(() => pg.send(prev), 30); return { ok: true, status: 200, data: null };
      }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.lastState = undefined;
    play(state({}));
    history.length = 0; // start of the leg: nothing before it can be undone
    const darts = [T(20, 1), T(20, 1), T(20, 1)];
    for (let i = 1; i <= 3; i++) play(state({ round: 1, turns: [{ round: 1, playerId: "p1", throws: darts.slice(0, i) }], gameScores: [501 - 20 * i] }));
    play(state({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [441] }));
    await sleep(300);
    check("mid-leg: first visit (round 1) published", visits(store).length === 1 && visits(store)[0].id === "m1/0.0.1.0", visits(store));
    order(store);
    await sleep(2500);
    check("mid-leg: Undo x4 back to the leg start, nothing else", pg.calls.join("|") === Array(4).fill("POST /matches/m1/undo").join("|"), pg.calls);
    check("mid-leg: ack ok (leg od nowa, Undo)", ack(store).state === "ok" && /Undo \(4/.test(ack(store).how) && ack(store).v && /undo .* \u00d74/.test(ack(store).steps.join()), ack(store));
    check("mid-leg: turns shown again while rewinding are not sent", visits(store).length === 1, visits(store));
    // the restarted leg: round 1 again
    pg.send(state({ round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(5, 1), T(1, 1), T(20, 1)] }], gameScores: [475] }));
    pg.send(state({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [475] }));
    await sleep(300);
    const v = visits(store);
    check("after restart: round 1 of the new leg is published with a new id (no duplicate filter)", v.length === 2 && v[1].id !== v[0].id && /^m1\/0\.0\.1\.0~/.test(v[1].id) && v[1].labels === "S5 S1 S20", v);
    check("epoch saved for a reload of the game tab", (store.get("ad2dc3_play_epoch") || {}).matchId === "m1", store.get("ad2dc3_play_epoch"));
  }

  // 1b) the app's Undo refused -> games/restart (in the app's API client) gives the fresh leg
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") { setTimeout(() => pg.send(state({})), 50); return { ok: true, status: 200, data: null }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(2500);
    check("undo refused -> POST games/restart", pg.calls.join("|") === "POST /matches/m1/undo|POST /matches/m1/games/restart", pg.calls);
    check("undo refused -> ack ok with both HTTP codes", ack(store).state === "ok" && /games\/restart/.test(ack(store).how) &&
      ack(store).steps.join("|") === "POST /matches/m1/undo \u2192 HTTP 404|POST /matches/m1/games/restart \u2192 HTTP 200", ack(store));
  }

  // 2) leg finished in Autodarts (our checkout) -> games/next
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(state({ leg: 1 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 7, gameScores: [0], gameFinished: true, turns: [{ round: 7, playerId: "p1", throws: [T(20, 2)] }] }));
    await sleep(300);
    order(store);
    await sleep(2500);
    check("leg over: POST games/next only", pg.calls.join("|") === "POST /matches/m1/games/next", pg.calls);
    check("leg over: ack ok (next leg)", ack(store).state === "ok" && /games\/next/.test(ack(store).how), ack(store));
  }

  // 3) restart not accepted -> new match: from-match, DELETE old, start, go to the new match
  {
    const store = makeStore();
    const pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") return { ok: false, status: 400, err: "HTTP 400 not supported" };
      if (m === "POST" && p === "/lobbies/from-match/m1") return { ok: true, status: 200, data: { id: "L1" } };
      if (m === "DELETE" && p === "/matches/m1") return { ok: true, status: 200 };
      if (m === "POST" && p === "/lobbies/L1/start") return { ok: true, status: 200, data: { id: "m2" } };
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(3000);
    check("restart refused -> from-match, DELETE old match, start lobby (in this order)",
      pg.calls.join("|") === "POST /matches/m1/undo|POST /matches/m1/games/restart|POST /lobbies/from-match/m1|DELETE /matches/m1|POST /lobbies/L1/start", pg.calls);
    check("new match: ack ok", ack(store).state === "ok" && /nowy mecz X01/.test(ack(store).how), ack(store));
    check("new match: the tab goes to it", pg.nav.length === 1, pg.nav);
  }

  // 4) no lobby from the running match -> "Leave match" (surrender), then the lobby from the finished match (Play again)
  {
    const store = makeStore();
    let pg, left = false;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") return { ok: false, status: 400, err: "HTTP 400" };
      if (p === "/lobbies/from-match/m1") return left ? { ok: true, status: 200, data: { id: "L2" } } : { ok: false, status: 409, err: "HTTP 409 match not finished" };
      if (p === "/matches/m1/surrender") { left = true; setTimeout(() => pg.send(state({ round: 3, gameScores: [380], finished: true })), 100); return { ok: true, status: 200 }; }
      if (p === "/lobbies/L2/start") return { ok: true, status: 200, data: { id: "m3" } };
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(3500);
    check("from-match refused -> surrender, from-match again, start (no DELETE)",
      pg.calls.join("|") === "POST /matches/m1/undo|POST /matches/m1/games/restart|POST /lobbies/from-match/m1|POST /matches/m1/surrender|POST /lobbies/from-match/m1|POST /lobbies/L2/start", pg.calls);
    check("surrender path: ack ok, tab goes to the new match", ack(store).state === "ok" && /opuszczony/.test(ack(store).how) && pg.nav.length === 1, { ack: ack(store), nav: pg.nav });
    check("every API step is in the game tab log", pg.logs.filter(l => /Reset API: /.test(l)).length === 6 && pg.logs.some(l => /Reset: polecenie .* stan|Reset: polecenie .*runda 3/.test(l)), pg.logs.filter(l => /Reset/.test(l)));
  }

  // 4b) nothing works -> clear failure, nothing deleted
  {
    const store = makeStore();
    const pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") return { ok: false, status: 400, err: "HTTP 400" };
      if (p === "/matches/m1/games/restart") return { ok: false, status: 400, err: "HTTP 400" };
      if (p === "/lobbies/from-match/m1") return { ok: false, status: 409, err: "HTTP 409 match not finished" };
      if (p === "/matches/m1/surrender") return { ok: false, status: 403, err: "HTTP 403" };
      return { ok: true, status: 200 };
    });
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(3000);
    check("all refused -> the running match is NOT deleted", !pg.calls.some(c => /^DELETE/.test(c)), pg.calls);
    check("all refused -> ack fail with reason", ack(store).state === "fail" && /zako\u0144czy\u0107 meczu/.test(ack(store).how), ack(store));
  }

  // 5) login missing -> no fallback that ends the match
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: false, status: 0, err: "brak tokenu logowania Autodarts (odśwież kartę gry)" }));
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(2500);
    check("no token -> one request, ack fail with the token message", pg.calls.length === 1 && ack(store).state === "fail" && /tokenu/.test(ack(store).how), { calls: pg.calls, ack: ack(store) });
  }

  // 6) darts of a turn in progress: that turn goes to DartCounter first, then the reset
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") { setTimeout(() => pg.send(state({})), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 4, gameScores: [300], turns: [{ round: 4, playerId: "p1", throws: [T(19, 3)] }] }));
    order(store);
    await sleep(1500);
    check("turn in progress -> no request yet", pg.calls.length === 0, pg.calls);
    pg.send(state({ round: 4, gameScores: [300], turns: [{ round: 4, playerId: "p1", throws: [T(19, 3), T(19, 1)] }] }));
    pg.send(state({ round: 5, gameScores: [224], turns: [{ round: 5, playerId: "p1", throws: [] }] }));
    await sleep(2500);
    const v = visits(store);
    check("turn in progress -> its visit is published (not lost)", v.length === 1 && v[0].labels === "T19 S19", v);
    check("then the reset (undo refused here -> games/restart), ack ok", pg.calls.join("|") === "POST /matches/m1/undo|POST /matches/m1/games/restart" && ack(store).state === "ok", { calls: pg.calls, ack: ack(store) });
  }

  // 7) Autodarts already at the start of a leg -> nothing to do
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(1800);
    pg.send(state({}));
    order(store);
    await sleep(1500);
    check("fresh leg already -> no request, ack ok", pg.calls.length === 0 && ack(store).state === "ok", { calls: pg.calls, ack: ack(store) });
  }

  // 8) an order older than this page is ignored; not X01 -> fail
  {
    const store = makeStore();
    store.set("ad2dc3_reset_cmd", { id: "old", ts: Date.now(), kind: "leg" });
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(2500);
    check("order from before the page load is ignored", pg.calls.length === 0 && !store.get("ad2dc3_reset_ack"), { calls: pg.calls, ack: store.get("ad2dc3_reset_ack") });
    pg.send(state({ variant: "ATC", gameScores: [1] }));
    order(store);
    await sleep(1500);
    check("not X01 -> ack fail, no request", pg.calls.length === 0 && ack(store).state === "fail" && /X01/.test(ack(store).how), ack(store));
  }

  // 9) Around the Clock: Autodarts game over (finished on 25) -> next game; an X01 order on an ATC game still fails
  {
    const store = makeStore();
    let pg;
    const atc = o => state(Object.assign({ variant: "ATC", settings: { order: "1-20-Bull", mode: "Full", hits: 1 }, gameScores: [21] }, o));
    const dcBeat = dcAtc(store);
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(atc({ leg: 1, gameScores: [0], round: 1 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(atc({ round: 9, turns: [{ round: 9, playerId: "p1", throws: [T(20, 1)] }] }));
    pg.send(atc({ round: 9, finished: true, turns: [{ round: 9, playerId: "p1", throws: [T(20, 1), T(25, 1)] }] }));
    await sleep(300);
    store.set("ad2dc3_reset_cmd", { id: "dc-atc1", ts: Date.now(), kind: "atc", won: false });
    await sleep(2500);
    // 3.5.5: the game tab corrects the 25 (refused here) and restarts Autodarts by itself; the order from DartCounter
    // meets the restart: one games/next in total
    check("ATC finished on 25 -> one POST games/next in total, ack ok", pg.calls.filter(c => /games\/next/.test(c)).length === 1 && ack(store).state === "ok" && /ATC/.test(ack(store).how), { calls: pg.calls, ack: ack(store) });
    pg.send(atc({ leg: 1, round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(25, 2)] }] }));
    pg.send(atc({ leg: 1, round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }] }));
    await sleep(300);
    const v = visits(store);
    check("ATC: darts after the new game are published (new id)", v.length === 2 && v[1].labels === "BULL" && v[1].id !== v[0].id && v[0].finished === true, v);
    const before = pg.calls.length;
    order(store, "leg");
    await sleep(1500);
    check("X01 order (leg end) on an ATC game -> fail, nothing called", pg.calls.length === before && ack(store).state === "fail" && /X01/.test(ack(store).how), { calls: pg.calls, ack: ack(store) });
    clearInterval(dcBeat);
  }

  // 11) 3.5.4 X01: won leg in Autodarts (checkout, score 0) -> next leg by itself after the visit went out
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(state({ leg: 1 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 7, gameScores: [40], turns: [{ round: 7, playerId: "p1", throws: [T(20, 1)] }] }));
    pg.send(state({ round: 7, gameScores: [0], gameFinished: true, turns: [{ round: 7, playerId: "p1", throws: [T(20, 1), T(10, 2)] }] }));
    await sleep(500);
    check("won leg: the checkout visit goes out at once", visits(store).length === 1 && visits(store)[0].labels === "S20 D10", visits(store));
    check("won leg: no request before 2.5 s", pg.calls.length === 0, pg.calls);
    await sleep(3000);
    check("won leg: POST games/next by itself", pg.calls.join("|") === "POST /matches/m1/games/next", pg.calls);
    check("won leg: result for the DartCounter panel", (store.get("ad2dc3_auto_next") || {}).ok === true, store.get("ad2dc3_auto_next"));
    pg.send(state({ leg: 1, round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(20, 3)] }], gameScores: [441] }));
    pg.send(state({ leg: 1, round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [441] }));
    await sleep(300);
    check("next leg: its first visit is published", visits(store).length === 2 && visits(store)[1].labels === "T20", visits(store));
  }
  // won leg and the reset order from DartCounter at the same time -> one games/next only
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(state({ leg: 1 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 7, gameScores: [40], turns: [{ round: 7, playerId: "p1", throws: [T(20, 1)] }] }));
    pg.send(state({ round: 7, gameScores: [0], gameFinished: true, turns: [{ round: 7, playerId: "p1", throws: [T(20, 1), T(10, 2)] }] }));
    await sleep(2000);
    order(store, "leg");
    await sleep(4000);
    check("won leg + reset order -> games/next once", pg.calls.filter(c => /games\/next/.test(c)).length === 1, pg.calls);
  }
  // setting off -> no auto next
  {
    const store = makeStore();
    store.set("ad2dc3_reset_mode", "off");
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(2500);
    pg.send(state({ round: 7, gameScores: [40], turns: [{ round: 7, playerId: "p1", throws: [T(20, 1)] }] }));
    pg.send(state({ round: 7, gameScores: [0], gameFinished: true, turns: [{ round: 7, playerId: "p1", throws: [T(20, 1), T(10, 2)] }] }));
    await sleep(3500);
    check("Reset Autodarts off -> no auto next leg", pg.calls.length === 0, pg.calls);
  }
  // the page helper answers with another source (Tampermonkey: window is a proxy) -> answers still taken
  {
    const store = makeStore();
    const vc = null;
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") { setTimeout(() => pg.send(state({})), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    }, null, { source: null });
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    order(store);
    await sleep(2500);
    check("helper answer without source === window (sandbox) -> ack ok", ack(store).state === "ok", ack(store));
  }

  // 10) Around the Clock, mode Full: 25 on the bull target -> step 1: the app's correction "bouncer" (3.5.6), step 2:
  //     Undo on the 25 + Miss to DartCounter, step 3: the 3.5.5 restart. Only while DartCounter plays ATC (heartbeat).
  const atcBull = o => state(Object.assign({ variant: "ATC", settings: { order: "1-20-Bull", mode: "Full", hits: 1 }, gameScores: [20],
    state: { targets: [[...Array.from({ length: 20 }, (_, i) => ({ number: i + 1, bed: "Full" })), { number: 25, bed: "Full" }]], currentTargets: [20] } }, o));
  const turn = (round, throws) => ({ round, turns: [{ round, playerId: "p1", throws }] });
  const C = (n, m, x, y) => Object.assign(T(n, m), { coords: { x, y } });
  {
    const store = makeStore();
    const dcBeat10 = dcAtc(store);
    let pg, body = null;
    pg = makePlay(store, (m, p, b) => {
      if (m === "PATCH" && p === "/matches/m1/throws") {
        setTimeout(() => pg.send(atcBull(turn(12, [T(20, 1), { segment: { name: "Miss", number: 0, multiplier: 0, bed: "Outside" } }]))), 60);
        return { ok: true, status: 200 };
      }
      return { ok: false, status: 404, err: "HTTP 404" };
    }, d => { body = d.body; });
    await sleep(1800);
    pg.send(atcBull(turn(12, [T(20, 1)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), C(25, 1, 0.03, 0.04)]), { finished: true })));
    await sleep(600);
    check("ATC 25 on the bull -> step 1: PATCH throws in the app's format { type: 'bouncer' } (no 'Normal')",
      pg.calls.join("|") === "PATCH /matches/m1/throws" && JSON.stringify(body) === JSON.stringify({ changes: { "1": { type: "bouncer" } } }), { calls: pg.calls, body });
    check("ATC 25 on the bull -> no visit while Autodarts corrects", visits(store).length === 0, visits(store));
    pg.send(atcBull(turn(12, [T(20, 1), { segment: { name: "Miss", number: 0, multiplier: 0, bed: "Outside" } }, T(25, 2)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), { segment: { name: "Miss", number: 0, multiplier: 0, bed: "Outside" } }, T(25, 2)]), { finished: true })));
    await sleep(400);
    const v = visits(store);
    check("after the correction: one visit S20 Miss BULL, ends the game on 50", v.length === 1 && v[0].labels.split(" ").length === 3 && v[0].labels.split(" ")[0] === "S20" && v[0].labels.split(" ")[1] !== "25" && v[0].labels.split(" ")[2] === "BULL" && v[0].finished === true, v);
    check("correction logged (step 1 of 3)", pg.logs.some(l => /25 na bullu/.test(l)) && pg.logs.some(l => /krok 1 z 3\]: Autodarts przyj\u0105\u0142 korekt/.test(l)) &&
      (store.get("ad2dc3_atc_fix") || {}).path === 1, pg.logs.filter(l => /ATC/.test(l)));
    clearInterval(dcBeat10);
  }
  // correction refused -> step 2: Undo on the 25; Autodarts plays on, DartCounter gets a Miss in place of the 25
  {
    const store = makeStore();
    const dcBeat = dcAtc(store);
    let pg;
    pg = makePlay(store, (m, p) => {
      if (m === "PATCH") return { ok: false, status: 400, err: "HTTP 400 invalid" };
      if (p === "/matches/m1/undo") { setTimeout(() => pg.send(atcBull(turn(12, [T(20, 1)]))), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(atcBull(turn(12, [T(20, 1)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), T(25, 1)]), { finished: true, gameFinished: true, winner: 0 })));
    await sleep(800);
    check("correction refused -> Undo on the 25 (PATCH, then POST undo), no restart", pg.calls.join("|") === "PATCH /matches/m1/throws|POST /matches/m1/undo", pg.calls);
    pg.send(atcBull(turn(12, [T(20, 1), T(1, 1)]))); // the next dart of the turn
    pg.send(atcBull(turn(13, [])));
    await sleep(500);
    const v = visits(store);
    check("Undo -> one visit with Miss in place of the 25: S20 M S1, game not finished", v.length === 1 && v[0].labels === "S20 M S1" && v[0].finished === false, v);
    check("Undo logged as step 2 of 3", pg.logs.some(l => /krok 2 z 3\]: Undo/.test(l)) && (store.get("ad2dc3_atc_fix") || {}).path === 2, pg.logs.filter(l => /ATC/.test(l)));
    clearInterval(dcBeat);
  }
  // correction accepted but Autodarts still ends the game -> Undo
  {
    const store = makeStore();
    const dcBeat = dcAtc(store);
    let pg;
    const miss = { segment: { name: "Miss", number: 0, multiplier: 0, bed: "Outside" } };
    pg = makePlay(store, (m, p) => {
      if (m === "PATCH") { setTimeout(() => pg.send(atcBull(Object.assign(turn(12, [T(20, 1), miss]), { finished: true, gameFinished: true, winner: 0 }))), 50); return { ok: true, status: 200 }; }
      if (p === "/matches/m1/undo") { setTimeout(() => pg.send(atcBull(turn(12, [T(20, 1)]))), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(atcBull(turn(12, [T(20, 1)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), T(25, 1)]), { finished: true, gameFinished: true, winner: 0 })));
    await sleep(3500);
    check("correction accepted but game still over -> Undo (step 2)", pg.calls.join("|") === "PATCH /matches/m1/throws|POST /matches/m1/undo" && (store.get("ad2dc3_atc_fix") || {}).path === 2,
      { calls: pg.calls, fix: store.get("ad2dc3_atc_fix") });
    clearInterval(dcBeat);
  }
  // correction and Undo refused -> step 3: the visit with 25 ends the Autodarts game (DartCounter: Miss; restart)
  {
    const store = makeStore();
    const dcBeat = dcAtc(store);
    const pg = makePlay(store, () => ({ ok: false, status: 400, err: "HTTP 400 game finished" }));
    await sleep(1800);
    pg.send(atcBull(turn(12, [T(20, 1)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), T(25, 1)]), { finished: true })));
    await sleep(800);
    const v = visits(store);
    check("correction and Undo refused -> step 3: visit S20 25 published as finished (DartCounter: 25 = miss, Autodarts restarted)",
      v.length === 1 && v[0].labels === "S20 25" && v[0].finished === true && /^PATCH \/matches\/m1\/throws\|POST \/matches\/m1\/undo/.test(pg.calls.join("|")) &&
      (store.get("ad2dc3_atc_fix") || {}).path === 3, { v, calls: pg.calls });
    clearInterval(dcBeat);
  }
  // DartCounter counts 25 too ("bull or bullseye") -> no correction
  {
    const store = makeStore();
    store.set("ad2dc3_atc_dc", { throwout: "all", ts: Date.now() });
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(2500);
    pg.send(atcBull(turn(12, [T(20, 1)])));
    pg.send(atcBull(Object.assign(turn(12, [T(20, 1), T(25, 1)]), { finished: true })));
    await sleep(500);
    check("DartCounter bull setting 'all' -> no correction, visit as thrown", pg.calls.length === 0 && visits(store).length === 1, { calls: pg.calls, v: visits(store) });
  }
  // X01: S25 never corrected
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [100], turns: [{ round: 3, playerId: "p1", throws: [T(20, 1)] }] }));
    pg.send(state({ round: 3, gameScores: [55], turns: [{ round: 3, playerId: "p1", throws: [T(20, 1), T(25, 1)] }] }));
    await sleep(500);
    check("X01: 25 is never corrected", pg.calls.length === 0, pg.calls);
  }

  // 3.5.5: data shaped like real Autodarts frames: throws with an id, 1-based set/leg, winner -1, ATC state.targets
  const R = (id, n, m) => Object.assign(T(n, m), { id });
  const real = o => state(Object.assign({ set: 1, leg: 1, winner: -1, players: [{ id: "p1", name: "Ja", cpuPPR: null }] }, o));
  // a dart thrown while the leg is rewound: it is undone as well and listed for DartCounter (never a silent loss)
  {
    const store = makeStore();
    let pg;
    const history = [];
    const play = s => { history.push(pg.lastState); pg.lastState = s; pg.send(s); };
    let undos = 0;
    pg = makePlay(store, (m, p) => {
      if (p !== "/matches/m1/undo") return { ok: false, status: 404, err: "HTTP 404" };
      if (!history.length) return { ok: false, status: 400, err: "HTTP 400" };
      undos++;
      const prev = history.pop(); pg.lastState = prev;
      setTimeout(() => {
        pg.send(prev);
        if (undos === 2) play(Object.assign({}, prev, { turns: [{ round: prev.round, playerId: "p1", throws: prev.turns[0].throws.concat([R("new1", 19, 3)]) }] })); // the player throws
      }, 30);
      return { ok: true, status: 200 };
    });
    await sleep(1800);
    pg.lastState = real({});
    pg.send(pg.lastState);
    const d = [R("a1", 20, 1), R("a2", 20, 1), R("a3", 20, 1)];
    for (let i = 1; i <= 3; i++) play(real({ round: 1, turns: [{ round: 1, playerId: "p1", throws: d.slice(0, i) }], gameScores: [501 - 20 * i] }));
    play(real({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [441] }));
    await sleep(300);
    order(store);
    await sleep(3000);
    const a = ack(store);
    check("dart during the rewind -> undone too, leg fresh, ack ok", a.state === "ok" && pg.lastState.gameScores[0] === 501 && pg.lastState.turns[0].throws.length === 0, { a, calls: pg.calls });
    check("dart during the rewind -> listed in the answer (T19), never a visit", Array.isArray(a.extra) && a.extra.join() === "T19" && visits(store).length === 1, { a, v: visits(store) });
  }
  // DartCounter sends the same order again (no answer seen there yet): answered again, run once
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") { setTimeout(() => pg.send(real({})), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(real({ round: 3, gameScores: [380] }));
    const cmd = { id: "dc-again", ts: Date.now(), kind: "leg", won: false, v: "3.5.5", attempt: 1 };
    store.set("ad2dc3_reset_cmd", cmd);
    await sleep(150);
    check("order -> 'received' answer at once, with this version", ["received", "busy", "ok"].includes(ack(store).state) && ack(store).id === "dc-again" && !!ack(store).v, ack(store));
    await sleep(2000);
    const ts1 = ack(store).ts;
    store.set("ad2dc3_reset_cmd", Object.assign({}, cmd, { attempt: 2, ts: Date.now() }));
    await sleep(800);
    check("same order again -> answered again (new ts), not run twice", ack(store).state === "ok" && ack(store).ts > ts1 &&
      pg.calls.filter(c => /games\/restart/.test(c)).length === 1, { calls: pg.calls, ack: ack(store) });
  }
  // Around the Clock ended by the outer bull: the game tab starts the next Autodarts game by itself (no DartCounter order)
  {
    const store = makeStore();
    let pg, after = null;
    const targets = (ci, done) => { const t = []; for (let n = 1; n <= 20; n++) t.push({ number: n, bed: "Full", hits: n - 1 < ci ? 1 : 0, count: n - 1 < ci ? 1 : 0 }); t.push({ number: 25, bed: "Full", hits: done ? 1 : 0, count: done ? 1 : 0 }); return [t]; };
    const dcBeat = dcAtc(store);
    const atcR = (o, throws, ci, done) => real(Object.assign({ variant: "ATC", settings: { mode: "Full", order: "1-20-Bull", hits: 1 }, round: 7, gameScores: [ci],
      turns: [{ id: "turn7", round: 7, playerId: "p1", throws }], state: { targets: targets(ci, done), currentTargets: [ci] } }, o));
    pg = makePlay(store, (m, p) => {
      if (m === "PATCH") return { ok: false, status: 400, err: "HTTP 400 game finished" };
      if (p === "/matches/m1/games/next") {
        after = visits(store).length;
        setTimeout(() => pg.send(atcR({ leg: 2, round: 1, turns: [{ id: "turn1", round: 1, playerId: "p1", throws: [] }] }, [], 0)), 50);
        return { ok: true, status: 200 };
      }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(atcR({}, [R("b1", 19, 1)], 19));
    pg.send(atcR({}, [R("b1", 19, 1), R("b2", 20, 1)], 20));
    pg.send(atcR({ finished: true, gameFinished: true, winner: 0 }, [R("b1", 19, 1), R("b2", 20, 1), R("b3", 25, 1)], 20, true));
    await sleep(4000);
    const an = store.get("ad2dc3_auto_next") || {};
    check("ATC over on 25 -> PATCH and Undo refused, then POST games/next by the game tab itself", pg.calls.join("|") === "PATCH /matches/m1/throws|POST /matches/m1/undo|POST /matches/m1/games/next", pg.calls);
    check("ATC over on 25 -> the visit S19 S20 25 went out before the restart", after === 1 && visits(store)[0].labels === "S19 S20 25" && visits(store)[0].finished === true, { after, v: visits(store) });
    check("ATC over on 25 -> result for the DartCounter panel (kind atc, ok)", an.kind === "atc" && an.ok === true && /games\/next/.test(an.how), an);
    check("ATC over on 25 -> no order from DartCounter needed", !store.get("ad2dc3_reset_cmd"), store.get("ad2dc3_reset_cmd"));
    clearInterval(dcBeat);
    // no DartCounter tab playing Around the Clock (closed, X01, other app): Autodarts games are never restarted
    const store3 = makeStore();
    const pg3 = makePlay(store3, () => ({ ok: true, status: 200 }));
    await sleep(1800);
    pg3.send(atcR({}, [R("d1", 20, 1)], 20));
    pg3.send(atcR({ finished: true, gameFinished: true, winner: 0 }, [R("d1", 20, 1), R("d2", 25, 1)], 20, true));
    await sleep(6500);
    check("ATC over on 25 without a DartCounter tab on Around the Clock -> no games/next, no new match", !pg3.calls.some(c => /games\/next|lobbies/.test(c)), pg3.calls);
    // ended on 50: nothing to restart
    const store2 = makeStore();
    const pg2 = makePlay(store2, () => ({ ok: true, status: 200 }));
    await sleep(1800);
    pg2.send(atcR({}, [R("c1", 20, 1)], 20));
    pg2.send(atcR({ finished: true, gameFinished: true, winner: 0 }, [R("c1", 20, 1), R("c2", 25, 2)], 20, true));
    await sleep(2500);
    check("ATC over on 50 -> no restart, no correction", pg2.calls.length === 0, pg2.calls);
  }

  // 3.5.6 X01: board Reset after a leg, ordered by DartCounter. Fake local Board Manager (GM_xmlhttpRequest): /api/state,
  // /api/reset (the board is throwing again after it). Order: the Autodarts reset of the leg first, then the board: when
  // it is ready, or still in takeout after 6 s (stuck, yellow in Autodarts Desktop); never with darts of a turn on it.
  const boardManager = (w, opt) => {
    const bm = { reqs: [], state: { status: "Takeout in progress", event: "Takeout started", numThrows: 0, throws: [] } };
    w.GM_xmlhttpRequest = d => {
      bm.reqs.push({ t: Date.now(), m: d.method, u: d.url });
      setTimeout(() => {
        if (opt && opt.down) return d.onerror({ error: "connection refused" });
        if (/\/api\/state$/.test(d.url)) return d.onload({ status: 200, responseText: JSON.stringify(bm.state) });
        if (d.method === "POST" && /\/api\/reset$/.test(d.url)) { bm.state = { status: "Throw", event: "Manual reset", numThrows: 0 }; if (bm.onReset) bm.onReset(); return d.onload({ status: 200, responseText: "" }); }
        d.onload({ status: 404, responseText: "" });
      }, 5);
    };
    return bm;
  };
  {
    const store = makeStore();
    let pg, resetDone = 0;
    const history = [];
    const play = s => { history.push(pg.lastState); pg.lastState = s; pg.send(s); };
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") { if (!history.length) return { ok: false, status: 400 }; const prev = history.pop(); pg.lastState = prev; setTimeout(() => { pg.send(prev); if (!history.length) resetDone = Date.now(); }, 30); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    const bm = boardManager(pg.w);
    await sleep(1800);
    pg.lastState = real({}); pg.send(pg.lastState); history.length = 0;
    for (let i = 1; i <= 3; i++) play(real({ round: 1, turns: [{ round: 1, playerId: "p1", throws: [R("e1", 20, 1), R("e2", 20, 1), R("e3", 20, 1)].slice(0, i) }], gameScores: [501 - 20 * i] }));
    play(real({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [441] }));
    await sleep(300);
    order(store);
    store.set("ad2dc3_board_cmd", { id: "dc-b1", ts: Date.now(), what: "koniec lega (przegrany)", v: "3.5.6", base: "http://127.0.0.1:3180" });
    await sleep(2500);
    check("board: waits a moment while the board shows a takeout (no POST /api/reset yet)", !bm.reqs.some(r => r.m === "POST") && (store.get("ad2dc3_board_ack") || {}).state === "waiting" &&
      /wyjmowanie/.test(store.get("ad2dc3_board_ack").how), { reqs: bm.reqs.slice(-3), ack: store.get("ad2dc3_board_ack") });
    bm.state = { status: "Throw", event: "Takeout finished", numThrows: 0 }; // darts pulled, board empty
    await sleep(4000);
    const post = bm.reqs.find(r => r.m === "POST");
    const ba = store.get("ad2dc3_board_ack") || {};
    check("board: empty -> POST http://127.0.0.1:3180/api/reset once, ack ok (local)", post && post.u === "http://127.0.0.1:3180/api/reset" && bm.reqs.filter(r => r.m === "POST").length === 1 &&
      ba.state === "ok" && /lokalnie: POST 127\.0\.0\.1:3180\/api\/reset \u2192 HTTP 200/.test(ba.how), { reqs: bm.reqs.filter(r => r.m === "POST"), ba });
    check("board: after the Autodarts reset of the leg (Undo done first)", resetDone && post && post.t > resetDone && ack(store).state === "ok", { resetDone, post, ack: ack(store) });
  }
  // stuck takeout after the leg (yellow): Reset after the grace time; state before and after in the answer
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: false, status: 404, err: "HTTP 404" }));
    const bm = boardManager(pg.w);
    bm.state = { status: "Takeout", event: "Takeout started", numThrows: 3, throws: [{ segmentName: "S20", segmentNumber: 20, multiplier: 1 }, { segmentName: "S1", segmentNumber: 1, multiplier: 1 }, { segmentName: "S5", segmentNumber: 5, multiplier: 1 }] };
    await sleep(1800);
    pg.send(real({}));
    store.set("ad2dc3_board_cmd", { id: "dc-b3", ts: Date.now(), what: "koniec lega (wygrany)", v: "3.5.6", base: "http://127.0.0.1:3180" });
    await sleep(5000);
    check("board stuck in takeout: no Reset before the grace time", !bm.reqs.some(r => r.m === "POST"), bm.reqs.filter(r => r.m === "POST"));
    await sleep(7000);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("board stuck in takeout -> Reset after ~6 s, answer with the state before (takeout) and after (throw)", ba.state === "ok" && bm.reqs.filter(r => r.m === "POST").length === 1 &&
      /przed: wyjmowanie lotek \(Takeout.*zawieszone.*lokalnie: POST 127\.0\.0\.1:3180\/api\/reset \u2192 HTTP 200 \| po: rzucanie \(Throw/.test(ba.how), ba);
  }
  // darts of a turn on the board (somebody throws): never a Reset then
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: false, status: 404, err: "HTTP 404" }));
    const bm = boardManager(pg.w);
    bm.state = { status: "Throw", event: "Throw detected", numThrows: 1, throws: [{ segmentName: "T20", segmentNumber: 20, multiplier: 3 }] };
    await sleep(1800);
    pg.send(real({}));
    store.set("ad2dc3_board_cmd", { id: "dc-b4", ts: Date.now(), what: "koniec lega (przegrany)", v: "3.5.6", base: "http://127.0.0.1:3180" });
    await sleep(8000);
    check("board with darts of a turn (throwing) -> no Reset, waits", !bm.reqs.some(r => r.m === "POST") && /lotki w tarczy/.test((store.get("ad2dc3_board_ack") || {}).how || ""), { reqs: bm.reqs.filter(r => r.m === "POST"), ack: store.get("ad2dc3_board_ack") });
  }
  // local Board Manager not reachable -> board state of the game page (channel autodarts.boards), cloud board Reset
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => (m === "POST" && p === "/boards/b-77/reset" ? { ok: true, status: 200 } : { ok: false, status: 404, err: "HTTP 404" }));
    boardManager(pg.w, { down: true });
    await sleep(1800);
    pg.send(real({ players: [{ id: "p1", name: "Ja", boardId: "b-77" }] }));
    const bws = pg.w.__ad2dcWs || null;
    pg.sendBoard({ status: "Throw", event: "Takeout finished", numThrows: 0 });
    store.set("ad2dc3_board_cmd", { id: "dc-b2", ts: Date.now(), what: "koniec lega (wygrany)", v: "3.5.6", base: "http://127.0.0.1:3180" });
    await sleep(5000);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("board: local Board Manager down -> cloud POST /boards/<id>/reset with the app's login, ack ok", pg.calls.join("|") === "POST /boards/b-77/reset" && ba.state === "ok" && /chmura: POST \/boards\/b-77\/reset \u2192 HTTP 200/.test(ba.how), { calls: pg.calls, ba });
  }

  // 3.6.0 Cricket: state as the Autodarts app reads it (settings.gameMode / scoringMode, state.segments, gameWinner)
  const cr = o => real(Object.assign({ variant: "Cricket", settings: { gameMode: "Cricket", scoringMode: "Standard", maxRounds: 50 }, gameScores: [0], gameWinner: -1,
    state: { segments: [[0, 0, 0, 0, 0, 0, 0]] } }, o));
  // won leg in Autodarts (game winner) -> next leg by itself, like X01
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(cr({ leg: 2 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(cr({ round: 9, turns: [{ round: 9, playerId: "p1", throws: [R("k1", 20, 1)] }] }));
    pg.send(cr({ round: 9, gameWinner: 0, turns: [{ round: 9, playerId: "p1", throws: [R("k1", 20, 1), R("k2", 25, 2)] }], state: { segments: [[3, 3, 3, 3, 3, 3, 3]] } }));
    await sleep(400);
    check("Cricket: the winning visit goes out at once (finished)", visits(store).length === 1 && visits(store)[0].labels === "S20 BULL" && visits(store)[0].finished === true && visits(store)[0].variant === "Cricket", visits(store));
    await sleep(3500);
    check("Cricket: won leg in Autodarts -> POST games/next by itself", pg.calls.join("|") === "POST /matches/m1/games/next" && (store.get("ad2dc3_auto_next") || {}).ok === true, { calls: pg.calls, an: store.get("ad2dc3_auto_next") });
  }
  // DartCounter Cricket leg end (order with game "cricket") on a running Autodarts Cricket leg -> Undo back to its start
  {
    const store = makeStore();
    let pg;
    const history = [];
    const play = s2 => { history.push(pg.lastState); pg.lastState = s2; pg.send(s2); };
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") { if (!history.length) return { ok: false, status: 400 }; const prev = history.pop(); pg.lastState = prev; setTimeout(() => pg.send(prev), 30); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.lastState = cr({}); pg.send(pg.lastState); history.length = 0;
    play(cr({ round: 1, turns: [{ round: 1, playerId: "p1", throws: [R("q1", 20, 3)] }], state: { segments: [[3, 0, 0, 0, 0, 0, 0]] } }));
    play(cr({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], state: { segments: [[3, 0, 0, 0, 0, 0, 0]] } }));
    await sleep(300);
    store.set("ad2dc3_reset_cmd", { id: "dc-cr1", ts: Date.now(), kind: "leg", won: false, game: "cricket", v: "3.6.0", attempt: 1 });
    await sleep(2500);
    check("Cricket order -> Undo back to the leg start, ack ok", ack(store).state === "ok" && /Undo/.test(ack(store).how) && pg.calls.every(c => /undo/.test(c)) && pg.calls.length === 2, { calls: pg.calls, ack: ack(store) });
    store.set("ad2dc3_reset_cmd", { id: "dc-cr2", ts: Date.now(), kind: "leg", won: false, v: "3.5.6", attempt: 1 }); // an X01 order (no game)
    await sleep(1500);
    check("X01 order on an Autodarts Cricket game -> fail, nothing called", ack(store).id === "dc-cr2" && ack(store).state === "fail" && /nie jest X01/.test(ack(store).how) && pg.calls.length === 2, ack(store));
  }
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    await sleep(1800);
    pg.send(state({ round: 3, gameScores: [380] }));
    store.set("ad2dc3_reset_cmd", { id: "dc-cr3", ts: Date.now(), kind: "leg", won: false, game: "cricket", v: "3.6.0", attempt: 1 });
    await sleep(1500);
    check("Cricket order on an Autodarts X01 game -> fail, nothing called", ack(store).state === "fail" && /nie jest Cricket/.test(ack(store).how) && pg.calls.length === 0, { ack: ack(store), calls: pg.calls });
  }
  // manual board Reset (button in DartCounter): at once, even in takeout or with darts on the board; state logged
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: false, status: 404, err: "HTTP 404" }));
    const bm = boardManager(pg.w);
    bm.state = { status: "Throw", event: "Throw detected", numThrows: 1, throws: [{ segmentName: "S20", segmentNumber: 20, multiplier: 1 }] };
    await sleep(1800);
    pg.send(real({}));
    const t0 = Date.now();
    store.set("ad2dc3_board_cmd", { id: "dc-man", ts: Date.now(), what: "reset ręczny", v: "3.6.0", base: "http://127.0.0.1:3180", manual: true });
    await sleep(6500);
    const post = bm.reqs.find(r => r.m === "POST"), ba = store.get("ad2dc3_board_ack") || {};
    check("manual board Reset -> POST /api/reset at once (no waiting for an empty board)", post && post.t - t0 < 1500 && ba.state === "ok" &&
      /przed: lotki w tarczy \(Throw.*reset ręczny \| lokalnie: POST 127\.0\.0\.1:3180\/api\/reset \u2192 HTTP 200 \| po: rzucanie/.test(ba.how), { post, t0, ba });
    check("manual: turn without darts -> no Next, the board waits for the first dart", /tarcza czeka na pierwsz/.test(ba.how) && pg.calls.length === 0, { ba, calls: pg.calls });
  }
  // manual board Reset, then on to the next throw: Autodarts still waits on the same full turn (3 darts, stuck takeout)
  // -> the app's own Next (POST players/next, Space in the app); the visit goes to DartCounter
  const full = real({ round: 2, gameScores: [441], turns: [{ round: 2, playerId: "p1", throws: [R("f1", 20, 1), R("f2", 20, 1), R("f3", 20, 1)] }] });
  const nextTurn = real({ round: 3, gameScores: [441], turns: [{ round: 3, playerId: "p1", throws: [] }] });
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (m === "POST" && p === "/matches/m1/players/next") { setTimeout(() => pg.send(nextTurn), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    const bm = boardManager(pg.w);
    await sleep(1800);
    pg.send(real({}));
    pg.send(full);
    await sleep(300);
    store.set("ad2dc3_board_cmd", { id: "dc-man2", ts: Date.now(), what: "reset ręczny", v: "3.6.0", base: "http://127.0.0.1:3180", manual: true });
    await sleep(8000);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("manual: stuck full turn -> board Reset, then POST players/next (the app's Next), ack ok", bm.reqs.some(r => r.m === "POST") &&
      pg.calls.join("|") === "POST /matches/m1/players/next" && ba.state === "ok" && /Dalej.*nast\u0119pna tura/.test(ba.how), { calls: pg.calls, ba });
    check("manual: the full turn goes to DartCounter after Next", visits(store).some(v => v.labels === "S20 S20 S20"), visits(store));
  }
  // Autodarts moves on by itself after the board Reset -> no Next
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, () => ({ ok: true, status: 200 }));
    const bm = boardManager(pg.w);
    bm.onReset = () => setTimeout(() => pg.send(nextTurn), 300);
    await sleep(1800);
    pg.send(real({}));
    pg.send(full);
    await sleep(300);
    store.set("ad2dc3_board_cmd", { id: "dc-man3", ts: Date.now(), what: "reset ręczny", v: "3.6.0", base: "http://127.0.0.1:3180", manual: true });
    await sleep(6000);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("manual: Autodarts moved on by itself after the Reset -> no Next", pg.calls.length === 0 && ba.state === "ok" && /przeszed\u0142 do nast\u0119pnej tury sam/.test(ba.how), { calls: pg.calls, ba });
  }
  // a turn in progress (2 darts) goes on: no Next
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: true, status: 200 }));
    boardManager(pg.w);
    await sleep(1800);
    pg.send(real({}));
    pg.send(real({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [R("g1", 20, 1), R("g2", 5, 1)] }] }));
    await sleep(300);
    store.set("ad2dc3_board_cmd", { id: "dc-man4", ts: Date.now(), what: "reset ręczny", v: "3.6.0", base: "http://127.0.0.1:3180", manual: true });
    await sleep(6000);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("manual: turn in progress (2 darts) -> no Next, ack ok", pg.calls.length === 0 && ba.state === "ok" && /tura w toku \(2 z 3/.test(ba.how), { calls: pg.calls, ba });
  }
  // Next refused by Autodarts -> fail with the reason (red in DartCounter)
  {
    const store = makeStore();
    const pg = makePlay(store, () => ({ ok: false, status: 403, err: "HTTP 403 forbidden" }));
    boardManager(pg.w);
    await sleep(1800);
    pg.send(real({}));
    pg.send(full);
    await sleep(300);
    store.set("ad2dc3_board_cmd", { id: "dc-man5", ts: Date.now(), what: "reset ręczny", v: "3.6.0", base: "http://127.0.0.1:3180", manual: true });
    await sleep(6500);
    const ba = store.get("ad2dc3_board_ack") || {};
    check("manual: Next refused -> ack fail with the HTTP answer", ba.state === "fail" && /Dalej\u201d nie wyszed\u0142: POST \/matches\/m1\/players\/next \u2192 HTTP 403/.test(ba.how), ba);
  }

  // 3.6.1: a new DartCounter game ("Rematch") -> order kind "new": Autodarts back at the start of the leg like after a
  // lost leg (Undo); nothing to do when it is there already
  {
    const store = makeStore();
    let pg;
    const history = [];
    const play = s2 => { history.push(pg.lastState); pg.lastState = s2; pg.send(s2); };
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") { if (!history.length) return { ok: false, status: 400 }; const prev = history.pop(); pg.lastState = prev; setTimeout(() => pg.send(prev), 30); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.lastState = real({}); pg.send(pg.lastState); history.length = 0;
    play(real({ round: 1, gameScores: [441], turns: [{ round: 1, playerId: "p1", throws: [R("n1", 20, 1), R("n2", 20, 1), R("n3", 20, 1)] }] }));
    play(real({ round: 2, gameScores: [441], turns: [{ round: 2, playerId: "p1", throws: [] }] }));
    await sleep(300);
    store.set("ad2dc3_reset_cmd", { id: "dc-new1", ts: Date.now(), kind: "new", won: null, game: "x01", v: "3.6.1", attempt: 1 });
    await sleep(2500);
    check("3.6.1: new DartCounter game on an X01 leg in progress -> Undo back to the leg start, ack ok", ack(store).id === "dc-new1" && ack(store).state === "ok" && /Undo/.test(ack(store).how) &&
      pg.calls.length === 2 && pg.calls.every(c => /undo/.test(c)) && pg.logs.some(l => /\(nowa gra w DartCounter\)/.test(l)), { calls: pg.calls, ack: ack(store) });
    store.set("ad2dc3_reset_cmd", { id: "dc-new2", ts: Date.now(), kind: "new", won: null, game: "x01", v: "3.6.1", attempt: 1 });
    await sleep(1500);
    check("3.6.1: new game when Autodarts is at the leg start already -> ok, nothing called", ack(store).id === "dc-new2" && ack(store).state === "ok" && /już jest na starcie/.test(ack(store).how) && pg.calls.length === 2, { ack: ack(store), calls: pg.calls });
    store.set("ad2dc3_reset_cmd", { id: "dc-new3", ts: Date.now(), kind: "new", won: null, game: "atc", v: "3.6.1", attempt: 1 });
    await sleep(1500);
    check("3.6.1: new Around the Clock game while Autodarts plays X01 -> fail, nothing called", ack(store).id === "dc-new3" && ack(store).state === "fail" && /nie jest Around the Clock/.test(ack(store).how) && pg.calls.length === 2, ack(store));
  }
  // 3.6.1: Around the Clock ended in DartCounter (order "match", game "atc"): lost -> the Autodarts game back to its start
  // (Undo); won (Autodarts finished on 50 too) -> next game (games/next)
  {
    const store = makeStore();
    let pg;
    const history = [];
    const atcS = o => state(Object.assign({ variant: "ATC", settings: { order: "1-20-Bull", mode: "Full", hits: 1 }, gameScores: [0] }, o));
    const play = s2 => { history.push(pg.lastState); pg.lastState = s2; pg.send(s2); };
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/undo") { if (!history.length) return { ok: false, status: 400 }; const prev = history.pop(); pg.lastState = prev; setTimeout(() => pg.send(prev), 30); return { ok: true, status: 200 }; }
      if (p === "/matches/m1/games/next") { setTimeout(() => pg.send(atcS({ leg: 2, round: 1 })), 50); return { ok: true, status: 200 }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.lastState = atcS({}); pg.send(pg.lastState); history.length = 0;
    play(atcS({ round: 1, gameScores: [2], turns: [{ round: 1, playerId: "p1", throws: [T(1, 1), T(2, 1), T(5, 1)] }] }));
    play(atcS({ round: 2, gameScores: [2], turns: [{ round: 2, playerId: "p1", throws: [] }] }));
    await sleep(300);
    store.set("ad2dc3_reset_cmd", { id: "dc-atc-end1", ts: Date.now(), kind: "match", won: false, game: "atc", v: "3.6.1", attempt: 1 });
    await sleep(2500);
    check("3.6.1: Around the Clock lost in DartCounter -> Autodarts game back to its start with Undo, ack ok", ack(store).id === "dc-atc-end1" && ack(store).state === "ok" && /Undo/.test(ack(store).how) &&
      pg.calls.length === 2 && pg.calls.every(c => /undo/.test(c)), { calls: pg.calls, ack: ack(store) });
    play(atcS({ round: 9, gameScores: [21], finished: true, gameFinished: true, winner: 0, turns: [{ round: 9, playerId: "p1", throws: [T(25, 2)] }] }));
    await sleep(300);
    store.set("ad2dc3_reset_cmd", { id: "dc-atc-end2", ts: Date.now(), kind: "match", won: true, game: "atc", v: "3.6.1", attempt: 1 });
    await sleep(2500);
    check("3.6.1: Around the Clock won (Autodarts finished on 50 too) -> next Autodarts game (games/next), ack ok", ack(store).id === "dc-atc-end2" && ack(store).state === "ok" &&
      pg.calls.slice(2).join("|") === "POST /matches/m1/games/next", { calls: pg.calls, ack: ack(store) });
  }

  console.log(failed ? "\n" + failed + " FAILED" : "\nall game-tab reset checks passed");
  process.exit(failed ? 1 : 0);
})();

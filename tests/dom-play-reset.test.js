// Run: npm install && node tests/dom-play-reset.test.js
// 3.5.1: the Autodarts game tab (play.autodarts.com) gets a reset order from the DartCounter tab.
// Fake page: a WebSocket that the script hooks (match state frames, channel autodarts.matches) and a fake
// page helper that answers the script's API requests (in the real page the injected helper calls api.autodarts.com).
// Plan, like the Autodarts Next button: leg over -> POST games/next; match over -> new match from the old one;
// leg in progress -> POST games/restart, if that gives no fresh leg -> new match (from-match, DELETE old, start).
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

function makePlay(store, api) {
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
    Promise.resolve(api(d.method, d.path)).then(res => {
      setTimeout(() => w.dispatchEvent(new w.MessageEvent("message", { data: Object.assign({ __ad2dcRes: 1, rid: d.rid }, res), source: w })), 20);
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
  return { w, calls, logs, send, nav };
}
const order = (store, kind) => store.set("ad2dc3_reset_cmd", { id: "dc-" + Math.random().toString(36).slice(2), ts: Date.now(), kind: kind || "leg", won: false });
const ack = store => store.get("ad2dc3_reset_ack") || {};
const visits = store => store.get("ad2dc3_play_visits") || [];

let failed = 0;
function check(name, cond, info) { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info)); } }

(async () => {
  // 1) leg in progress -> games/restart; the restarted leg repeats turn keys, its visits still go to DartCounter
  {
    const store = makeStore();
    let pg;
    pg = makePlay(store, (m, p) => {
      if (p === "/matches/m1/games/restart") { setTimeout(() => pg.send(state({})), 50); return { ok: true, status: 200, data: null }; }
      return { ok: false, status: 404, err: "HTTP 404" };
    });
    await sleep(1800);
    pg.send(state({ round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(20, 1), T(20, 1), T(20, 1)] }], gameScores: [441] }));
    pg.send(state({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [441] }));
    await sleep(300);
    check("mid-leg: first visit (round 1) published", visits(store).length === 1 && visits(store)[0].id === "m1/0.0.1.0", visits(store));
    order(store);
    await sleep(2500);
    check("mid-leg: POST games/restart", pg.calls.join("|") === "POST /matches/m1/games/restart", pg.calls);
    check("mid-leg: ack ok (leg od nowa)", ack(store).state === "ok" && /games\/restart/.test(ack(store).how), ack(store));
    // the restarted leg: round 1 again
    pg.send(state({ round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(5, 1), T(1, 1), T(20, 1)] }], gameScores: [475] }));
    pg.send(state({ round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }], gameScores: [475] }));
    await sleep(300);
    const v = visits(store);
    check("after restart: round 1 of the new leg is published with a new id (no duplicate filter)", v.length === 2 && v[1].id !== v[0].id && /^m1\/0\.0\.1\.0~/.test(v[1].id) && v[1].labels === "S5 S1 S20", v);
    check("epoch saved for a reload of the game tab", (store.get("ad2dc3_play_epoch") || {}).matchId === "m1", store.get("ad2dc3_play_epoch"));
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
      pg.calls.join("|") === "POST /matches/m1/games/restart|POST /lobbies/from-match/m1|DELETE /matches/m1|POST /lobbies/L1/start", pg.calls);
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
      pg.calls.join("|") === "POST /matches/m1/games/restart|POST /lobbies/from-match/m1|POST /matches/m1/surrender|POST /lobbies/from-match/m1|POST /lobbies/L2/start", pg.calls);
    check("surrender path: ack ok, tab goes to the new match", ack(store).state === "ok" && /opuszczony/.test(ack(store).how) && pg.nav.length === 1, { ack: ack(store), nav: pg.nav });
    check("every API step is in the game tab log", pg.logs.filter(l => /Reset API: /.test(l)).length === 5 && pg.logs.some(l => /Reset: polecenie .* stan|Reset: polecenie .*runda 3/.test(l)), pg.logs.filter(l => /Reset/.test(l)));
  }

  // 4b) nothing works -> clear failure, nothing deleted
  {
    const store = makeStore();
    const pg = makePlay(store, (m, p) => {
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
    check("then games/restart, ack ok", pg.calls.join("|") === "POST /matches/m1/games/restart" && ack(store).state === "ok", { calls: pg.calls, ack: ack(store) });
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
    check("ATC finished -> POST games/next, ack ok", pg.calls.join("|") === "POST /matches/m1/games/next" && ack(store).state === "ok" && /ATC/.test(ack(store).how), { calls: pg.calls, ack: ack(store) });
    pg.send(atc({ leg: 1, round: 1, turns: [{ round: 1, playerId: "p1", throws: [T(25, 2)] }] }));
    pg.send(atc({ leg: 1, round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }] }));
    await sleep(300);
    const v = visits(store);
    check("ATC: darts after the new game are published (new id)", v.length === 2 && v[1].labels === "BULL" && v[1].id !== v[0].id && v[0].finished === true, v);
    order(store, "leg");
    await sleep(1500);
    check("X01 order (leg end) on an ATC game -> fail, nothing called", pg.calls.length === 1 && ack(store).state === "fail" && /X01/.test(ack(store).how), { calls: pg.calls, ack: ack(store) });
  }

  console.log(failed ? "\n" + failed + " FAILED" : "\nall game-tab reset checks passed");
  process.exit(failed ? 1 : 0);
})();

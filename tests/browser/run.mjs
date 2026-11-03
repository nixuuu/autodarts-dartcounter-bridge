// Run: npm install && npx playwright install webkit chromium && npm run test:browser
// The userscript in real browser engines (WebKit = Safari, Chromium), in a Tampermonkey-like sandbox (window is a
// proxy, GM_* values shared between the tabs). Two tabs per scenario: DartCounter and the Autodarts game tab.
// 1) X01, lost leg: the DartBot wins the DartCounter leg -> leg end seen (rests, legs counter, IndexedDB) -> order to
//    the game tab -> "received" answer -> the app's Undo back to the leg start -> next visit still goes to DartCounter.
//    3.5.6: then the board Reset: the Board Manager (127.0.0.1:3180) is stuck in takeout -> Reset after the grace time.
// 2) Around the Clock, 25 on the bull, three ways (3.5.6): step 1 the app's correction "bouncer" accepted; step 2 refused
//    -> Undo on the 25; step 3 both refused -> the game tab starts the next Autodarts game. DartCounter always gets a
//    Miss for the 25 and ends on 50. No click in DartCounter.
// 3) The other tab runs another version: both panels say which tab to refresh.
// 4) Cricket (3.6.0): darts in and out of play, a turn of misses, the DartBot wins the leg -> reset order for Cricket ->
//    Undo in Autodarts -> board Reset (stuck takeout); then the manual "Reset tarczy" button on top of the overlay.
import { webkit, chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGM, createAutodarts, routeDartCounter, sleep } from "./harness.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = fs.readFileSync(path.join(dir, "..", "..", "autodarts-dartcounter-bridge.user.js"), "utf8");
const VERSION = /@version\s+(\S+)/.exec(SCRIPT)[1];
let failed = 0;
const check = (name, cond, info) => { if (cond) console.log("ok   " + name); else { failed++; console.log("FAIL " + name + " " + JSON.stringify(info).slice(0, 1500)); } };
const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100); } };

async function tabs(browser, gm, logs) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const dc = await ctx.newPage(), game = await ctx.newPage();
  for (const [pg, name] of [[dc, "DC"], [game, "AD"]]) {
    pg.on("console", m => { const t = m.text(); if (/^\[AD2DC\]/.test(t)) logs.push(name + " " + t.slice(8)); });
    pg.on("pageerror", e => logs.push(name + " PAGEERROR " + e.message));
    await gm.attach(pg, SCRIPT);
  }
  await routeDartCounter(dc);
  return { ctx, dc, game };
}
const has = (logs, re) => logs.some(l => re.test(l));
const pill = pg => pg.evaluate(() => { const r = document.getElementById("ad2dc-root"); return r && r.shadowRoot ? r.shadowRoot.getElementById("pilltxt").textContent : ""; });

for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await type.launch();
  console.log("--- " + name + " " + browser.version());

  // 1) X01 lost leg
  {
    const gm = createGM(), logs = [], ad = createAutodarts({ variant: "X01" });
    // the Board Manager stays in takeout after the leg (yellow in Autodarts Desktop), counting stops until a Reset
    gm.bm.state = { status: "Takeout", event: "Takeout started", numThrows: 3, throws: [{ segmentName: "S1", segmentNumber: 1, multiplier: 1 }] };
    const { ctx, dc, game } = await tabs(browser, gm, logs);
    await ad.route(game);
    await game.goto(ad.url());
    await dc.goto("https://app.dartcounter.net/game/match");
    await until(() => has(logs, /AD Odbieram stan meczu/) && has(logs, /DC Ta karta DartCounter jest aktywna/), 8000);
    const legs = () => dc.evaluate(() => Array.from(document.querySelectorAll("app-in-game-interim-score")).map(e => e.textContent.trim()).join("/"));
    for (let i = 0; i < 6 && (await legs()) === "0/0"; i++) {
      await until(() => dc.evaluate(() => !!document.querySelector("app-keyboard-score-input input")), 5000);
      await ad.visit(["S1", "S1", "S1"]);
      await until(() => dc.evaluate(() => !document.querySelector("app-keyboard-score-input input")), 5000);
      await until(async () => (await dc.evaluate(() => !!document.querySelector("app-keyboard-score-input input"))) || (await legs()) !== "0/0", 5000);
    }
    check(name + " X01: the DartBot won the DartCounter leg", (await legs()) === "0/1", await legs());
    const ack = await until(() => { const a = gm.get("ad2dc3_reset_ack"); return a && (a.state === "ok" || a.state === "fail") ? a : null; }, 15000);
    check(name + " X01: leg end seen in DartCounter, lost (DartBot per DartCounter's saved state)", has(logs, /DC Wykryto koniec lega/) && has(logs, /DC DartCounter: koniec lega \(przegrany\) \| stan gry DartCounter: wygrał DartBot/), logs.filter(l => /DC .*(koniec|Wykryto)/.test(l)));
    check(name + " X01: IndexedDB signal of DartCounter read", has(logs, /DC Stan gry DartCounter \(IndexedDB\)/), logs.filter(l => /IndexedDB/.test(l)));
    check(name + " X01: order sent, game tab answered 'received' with its version", has(logs, /DC Reset Autodarts: wysłano polecenie/) && has(logs, new RegExp("DC Reset Autodarts: karta gry odebrała polecenie \\(wersja " + VERSION.replace(/\./g, "\\."))), logs.filter(l => /Reset/.test(l)));
    check(name + " X01: Autodarts back at the leg start with the app's Undo only", ack && ack.state === "ok" && /Undo/.test(ack.how) && ad.api.every(a => /undo 200/.test(a)) && ad.api.length > 3 &&
      ad.m.gameScores[0] === 501 && ad.m.turns[0].throws.length === 0, { ack, api: ad.api, scores: ad.m.gameScores });
    check(name + " X01: every API step with its HTTP code in the DartCounter log", has(logs, /DC Reset Autodarts: karta gry: API POST \/matches\/\S+\/undo → HTTP 200/), logs.filter(l => /API/.test(l)));
    // the next visit after the reset goes to DartCounter (new visit id)
    await until(() => dc.evaluate(() => !!document.querySelector("app-keyboard-score-input input")), 8000);
    await ad.visit(["T20", "S1", "S1"]);
    const entered = await until(() => logs.find(l => /DC Wpisano 62 ✓/.test(l)), 8000);
    check(name + " X01: next visit after the reset entered in DartCounter", !!entered && has(logs, /DC Z gry Autodarts: T20 S1 S1 .*id \S+~/), logs.slice(-12));
    // board Reset after the leg: stuck takeout -> POST 127.0.0.1:3180/api/reset after the grace time, state before / after
    const ba = await until(() => { const a = gm.get("ad2dc3_board_ack"); return a && /^(ok|fail|skipped)$/.test(a.state) ? a : null; }, 20000);
    const posts = gm.bm.reqs.filter(r => r.method === "POST");
    check(name + " X01 board: stuck takeout after the leg -> one local Reset (POST 127.0.0.1:3180/api/reset), after the Autodarts reset",
      ba && ba.state === "ok" && posts.length === 1 && posts[0].url === "http://127.0.0.1:3180/api/reset" && posts[0].t > ack.ts, { ba, posts, ackTs: ack && ack.ts });
    const dcBoardLog = await until(() => has(logs, /DC Reset tarczy ✓ karta gry: przed: wyjmowanie/), 3000);
    check(name + " X01 board: state before (takeout) and after (throwing) in the answer and in the DartCounter log",
      ba && /przed: wyjmowanie lotek \(Takeout/.test(ba.how) && /po: rzucanie \(Throw/.test(ba.how) && dcBoardLog, { ba, logs: logs.filter(l => /tarczy/.test(l)) });
    check(name + " X01: no page errors", !logs.some(l => /PAGEERROR/.test(l)), logs.filter(l => /PAGEERROR/.test(l)));
    await ctx.close();
  }

  // 2) Around the Clock: 25 on the bull, step 1 / 2 / 3
  for (const mode of [{ step: 1, patch: "accept", undo: "ok" }, { step: 2, patch: "reject", undo: "ok" }, { step: 3, patch: "reject", undo: "refuse" }]) {
    const gm = createGM(), logs = [], ad = createAutodarts({ variant: "ATC" });
    ad.patchMode = mode.patch; ad.undoMode = mode.undo;
    const { ctx, dc, game } = await tabs(browser, gm, logs);
    const tag = name + " ATC step " + mode.step + ":";
    await ad.route(game);
    await game.goto(ad.url());
    await dc.goto("https://app.dartcounter.net/game/around-the-clock");
    await until(() => has(logs, /AD Odbieram stan meczu/) && has(logs, /DC Ta karta DartCounter jest aktywna/), 8000);
    const atc = () => dc.evaluate(() => ({ target: window.__atc.target, log: window.__atc.log.slice(), done: window.__atc.done }));
    const turns = [["S1", "S2", "S3"], ["S4", "S5", "S6"], ["S7", "S8", "S9"], ["S10", "S11", "S12"], ["S13", "S14", "S15"], ["S16", "S17", "S18"]];
    for (const t of turns) { const n = (await atc()).log.length; await ad.visit(t); await until(async () => (await atc()).log.length > n, 6000); }
    // the turn with the 25; the darts come out (takeout) a moment later, like on the real board
    const n7 = (await atc()).log.length;
    for (const l of ["S19", "S20", "25"]) { ad.dart(l); await sleep(150); }
    await sleep(1500);
    ad.takeout();
    await until(async () => (await atc()).log.length > n7, 8000);
    const fix = await until(() => gm.get("ad2dc3_atc_fix"), 8000);
    if (mode.step === 3) await until(() => gm.get("ad2dc3_auto_next"), 8000);
    let g = await atc();
    check(tag + " DartCounter took 25 as Miss and waits for the bull", g.log[g.log.length - 1] === "S19 S20 Miss" && g.target === 21 && !g.done, g);
    check(tag + " the app's correction format { type: 'bouncer' } was sent", JSON.stringify(ad.patchBody) === JSON.stringify({ changes: { "2": { type: "bouncer" } } }), ad.patchBody);
    const want = { 1: "PATCH /matches/{id}/throws 200", 2: "PATCH /matches/{id}/throws 400|POST /matches/{id}/undo 200",
      3: "PATCH /matches/{id}/throws 400|POST /matches/{id}/undo 400|POST /matches/{id}/games/next 200" }[mode.step];
    check(tag + " Autodarts calls " + want, ad.api.join("|") === want, ad.api);
    const dcStepLog = await until(() => has(logs, new RegExp("DC ATC: karta gry \\[krok " + mode.step + " z 3\\]")), 3000);
    check(tag + " the log says which step worked", fix && fix.path === mode.step && has(logs, new RegExp("AD ATC \\[krok " + mode.step + " z 3\\]")) && dcStepLog,
      { fix, logs: logs.filter(l => /krok/.test(l)) });
    check(tag + (mode.step < 3 ? " Autodarts plays on at the bull (same game)" : " Autodarts plays again (fresh game)"),
      mode.step < 3 ? !ad.m.finished && ad.m.leg === 1 && ad.m.state.currentTargets[0] === 20 : !ad.m.finished && ad.m.leg === 2, { leg: ad.m.leg, finished: ad.m.finished, target: ad.m.state.currentTargets[0] });
    await ad.visit(["BULL"]);
    g = await until(async () => { const x = await atc(); return x.done ? x : null; }, 6000);
    check(tag + " 50 ends the DartCounter game" + (mode.step < 3 ? " and the Autodarts game" : "") + ", nothing clicked by hand",
      g && g.done && g.log[g.log.length - 1] === "BULL" && (mode.step === 3 || ad.m.finished), { g: g || await atc(), adFinished: ad.m.finished });
    check(tag + " no page errors", !logs.some(l => /PAGEERROR/.test(l)), logs.filter(l => /PAGEERROR/.test(l)));
    await ctx.close();
  }

  // 4) Cricket
  {
    const gm = createGM(), logs = [], ad = createAutodarts({ variant: "Cricket" });
    gm.bm.state = { status: "Takeout", event: "Takeout started", numThrows: 3, throws: [{ segmentName: "S1", segmentNumber: 1, multiplier: 1 }] };
    const { ctx, dc, game } = await tabs(browser, gm, logs);
    await ad.route(game);
    await game.goto(ad.url());
    await dc.goto("https://app.dartcounter.net/game/cricket-tactics");
    await until(() => has(logs, /AD Odbieram stan meczu/) && has(logs, /DC Ta karta DartCounter jest aktywna/), 8000);
    const cr = () => dc.evaluate(() => ({ turns: window.__cr.turns.slice(), legs: window.__cr.teams.map(t => t.legs), mine: window.__cr.cur === 0 && !window.__cr.busy }));
    const myTurn = () => until(async () => (await cr()).mine, 8000);
    const turn = async (labels, n) => { await myTurn(); await ad.visit(labels); await until(async () => (await cr()).turns.length >= n, 8000); };
    await turn(["T20", "S19", "S5"], 1);
    await turn(["S3", "M", "S1"], 2);
    await turn(["S17", "S17", "S17"], 3);
    let c = await cr();
    check(name + " Cricket: T20 S19 S5 -> T20 S19 (S5 not in play); misses -> empty turn; S17 x3", JSON.stringify(c.turns) === '[["T20","S19"],[],["S17","S17","S17"]]', c);
    c = await until(async () => { const x = await cr(); return x.legs[1] === 1 ? x : null; }, 8000);
    check(name + " Cricket: the DartBot won the DartCounter leg", c && c.legs.join("/") === "0/1", c || await cr());
    const ack = await until(() => { const a = gm.get("ad2dc3_reset_ack"); return a && /^(ok|fail)$/.test(a.state) ? a : null; }, 15000);
    const cmd = gm.get("ad2dc3_reset_cmd");
    check(name + " Cricket: lost leg -> reset order for Cricket, Autodarts back at the leg start with Undo", cmd && cmd.game === "cricket" && cmd.won === false && ack && ack.state === "ok" && /Undo/.test(ack.how) &&
      ad.m.round === 1 && ad.m.turns[0].throws.length === 0 && ad.m.state.segments[0].every(x => x === 0), { cmd, ack, round: ad.m.round, seg: ad.m.state.segments });
    const ba = await until(() => { const a = gm.get("ad2dc3_board_ack"); return a && /^(ok|fail|skipped)$/.test(a.state) ? a : null; }, 20000);
    check(name + " Cricket: board Reset after the leg (stuck takeout)", ba && ba.state === "ok" && /zawieszone/.test(ba.how) && gm.bm.reqs.filter(r => r.method === "POST").length === 1, ba);
    // manual Reset: the button on top of the overlay (the leg's board Reset shows its check mark for 6 s)
    await sleep(6500);
    const label = () => dc.evaluate(() => { const b = document.getElementById("ad2dc-root").shadowRoot.getElementById("act"); return b && !b.hidden ? b.textContent : null; });
    check(name + " manual: 'Reset tarczy' button visible on top of the overlay", (await label()) === "Reset tarczy", await label());
    // the player's full turn stays on the board: Autodarts never sees the takeout end (orange board), nothing goes out
    await myTurn();
    const n0 = (await cr()).turns.length;
    await ad.visit(["T20", "T19", "M"], 150, true);
    gm.bm.state = { status: "Takeout", event: "Takeout started", numThrows: 3 };
    await sleep(1500);
    check(name + " manual: stuck full turn -> nothing entered yet", (await cr()).turns.length === n0, await cr());
    const t0 = Date.now();
    await dc.evaluate(() => document.getElementById("ad2dc-root").shadowRoot.getElementById("act").click());
    const ok = await until(async () => /✓/.test(await label() || ""), 12000);
    const posts = gm.bm.reqs.filter(r => r.method === "POST");
    const note = await dc.evaluate(() => { const m = document.getElementById("ad2dc-root").shadowRoot.getElementById("actmsg"); return m && !m.hidden ? m.textContent : null; });
    check(name + " manual: click -> board Reset at once (POST 127.0.0.1:3180/api/reset), then the app's Next, button 'Reset tarczy ✓' + green note", ok && posts.length === 2 && posts[1].t - t0 < 3000 &&
      ad.api.some(x => /^POST \/matches\/\{id\}\/players\/next 200$/.test(x)) && /tarcza gotowa\. „Dalej”/.test(note || "") &&
      has(logs, /DC Reset tarczy ✓ karta gry: przed: wyjmowanie lotek .*reset ręczny/), { posts, label: await label(), note, api: ad.api.slice(-3), logs: logs.filter(l => /tarczy/.test(l)).slice(-4) });
    const entered = await until(async () => { const x = await cr(); return x.turns.length > n0 ? x : null; }, 8000);
    check(name + " manual: after Next the turn goes to DartCounter (T20 T19, miss left out)", entered && JSON.stringify(entered.turns[entered.turns.length - 1]) === '["T20","T19"]', entered || await cr());
    check(name + " Cricket: no page errors", !logs.some(l => /PAGEERROR/.test(l)), logs.filter(l => /PAGEERROR/.test(l)));
    await ctx.close();
  }

  // 3) the other tab runs another version (or 3.5.4, which sends no version)
  {
    const gm = createGM(), logs = [], ad = createAutodarts({ variant: "X01" });
    gm.set("ad2dc3_play_hb", { ts: Date.now() + 60000, frames: 5, path: "/matches/old" }); // a 3.5.4 game tab
    gm.set("ad2dc3_dc_hb", { ts: Date.now() + 60000, v: "3.5.4", path: "/game/match" }); // a 3.5.4 DartCounter tab
    const { ctx, dc, game } = await tabs(browser, gm, logs);
    await dc.goto("https://app.dartcounter.net/game/match");
    const p1 = await until(async () => { const t = await pill(dc); return /odśwież kartę gry/.test(t) ? t : null; }, 6000);
    check(name + " version: DartCounter panel says 'refresh the game tab'", !!p1 && has(logs, /DC Karta gry: WERSJA sprzed 3\.5\.5/), { p1, logs: logs.filter(l => /Karta gry/.test(l)) });
    await dc.close(); // only the old DartCounter tab left (its heartbeat: 3.5.4)
    gm.set("ad2dc3_dc_hb", { ts: Date.now() + 60000, v: "3.5.4", path: "/game/match" });
    await ad.route(game);
    await game.goto(ad.url());
    const p2 = await until(async () => { const t = await pill(game); return /odśwież kartę DartCounter/.test(t) ? t : null; }, 6000);
    check(name + " version: game tab panel says 'refresh the DartCounter tab'", !!p2 && has(logs, /AD Karta DartCounter: WERSJA 3\.5\.4/), { p2, logs: logs.filter(l => /Karta DartCounter/.test(l)) });
    await ctx.close();
  }
  await browser.close();
}
console.log(failed ? "\n" + failed + " FAILED" : "\nall browser checks passed (WebKit + Chromium)");
process.exit(failed ? 1 : 0);

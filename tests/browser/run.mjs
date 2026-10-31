// Run: npm install && npx playwright install webkit chromium && npm run test:browser
// The userscript in real browser engines (WebKit = Safari, Chromium), in a Tampermonkey-like sandbox (window is a
// proxy, GM_* values shared between the tabs). Two tabs per scenario: DartCounter and the Autodarts game tab.
// 1) X01, lost leg: the DartBot wins the DartCounter leg -> leg end seen (rests, legs counter, IndexedDB) -> order to
//    the game tab -> "received" answer -> the app's Undo back to the leg start -> next visit still goes to DartCounter.
// 2) Around the Clock, 25 on the bull: Autodarts ends its game, DartCounter takes 25 as Miss, the game tab starts the
//    next Autodarts game by itself (games/next), 50 ends DartCounter's game. No click in DartCounter.
// 3) The other tab runs another version: both panels say which tab to refresh.
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
    check(name + " X01: no page errors", !logs.some(l => /PAGEERROR/.test(l)), logs.filter(l => /PAGEERROR/.test(l)));
    await ctx.close();
  }

  // 2) Around the Clock: 25 on the bull
  {
    const gm = createGM(), logs = [], ad = createAutodarts({ variant: "ATC" });
    const { ctx, dc, game } = await tabs(browser, gm, logs);
    await ad.route(game);
    await game.goto(ad.url());
    await dc.goto("https://app.dartcounter.net/game/around-the-clock");
    await until(() => has(logs, /AD Odbieram stan meczu/) && has(logs, /DC Ta karta DartCounter jest aktywna/), 8000);
    const atc = () => dc.evaluate(() => ({ target: window.__atc.target, log: window.__atc.log.slice(), done: window.__atc.done }));
    const turns = [["S1", "S2", "S3"], ["S4", "S5", "S6"], ["S7", "S8", "S9"], ["S10", "S11", "S12"], ["S13", "S14", "S15"], ["S16", "S17", "S18"], ["S19", "S20", "25"]];
    for (const t of turns) { const n = (await atc()).log.length; await ad.visit(t); await until(async () => (await atc()).log.length > n, 6000); }
    const an = await until(() => { const a = gm.get("ad2dc3_auto_next"); return a && a.kind === "atc" ? a : null; }, 8000);
    let g = await atc();
    check(name + " ATC: DartCounter took 25 as Miss and waits for the bull", g.log[g.log.length - 1] === "S19 S20 Miss" && g.target === 21 && !g.done, g);
    check(name + " ATC: correction tried (PATCH), then games/next by the game tab itself", ad.api.join("|") === "PATCH /matches/{id}/throws 400|POST /matches/{id}/games/next 200", ad.api);
    check(name + " ATC: Autodarts plays again (fresh game), result for the DartCounter panel", an && an.ok && !ad.m.finished && ad.m.leg === 2, { an, leg: ad.m.leg });
    check(name + " ATC: no order from DartCounter was needed", !gm.get("ad2dc3_reset_cmd") || has(logs, /DC ATC: karta gry już sama zaczęła/), gm.get("ad2dc3_reset_cmd"));
    await ad.visit(["BULL"]);
    g = await until(async () => { const x = await atc(); return x.done ? x : null; }, 6000);
    check(name + " ATC: 50 ends the DartCounter game, nothing clicked by hand", g && g.done && g.log[g.log.length - 1] === "BULL", g || await atc());
    check(name + " ATC: no page errors", !logs.some(l => /PAGEERROR/.test(l)), logs.filter(l => /PAGEERROR/.test(l)));
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

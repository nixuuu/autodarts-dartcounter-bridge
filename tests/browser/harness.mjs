// Browser test harness (Playwright, WebKit and Chromium).
// - Tampermonkey-like userscript environment: GM_* values in one store per browser (like the extension), a synchronous
//   cache per tab, changes pushed to the other tabs asynchronously (value change listeners get remote = true);
//   the script sees a Proxy as `window` (window !== unsafeWindow), like Tampermonkey's JS sandbox.
// - Fake Autodarts game server + game page: state frames shaped like the real ones (channel autodarts.matches, 1-based
//   set/leg/round, winner -1, throws with an id, turns[0] = turn in progress, ATC state.targets/currentTargets with
//   number/bed/hits/count). Undo works like the app's engine: one action back, never past the start of a leg.
// - Fake DartCounter pages built from the real app's markup (captured on app.dartcounter.net, 2026-10-31): X01 local
//   match vs DartBot (app-remaining-score, app-in-game-interim-score, score input) that saves its state to IndexedDB
//   like the app (dartcounter-db / unfinishedLocalMatches), and the Around the Clock hit keyboard.
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createGM() {
  const store = Object.create(null);
  const pages = new Set();
  // fake local Board Manager (Autodarts Desktop) behind GM_xmlhttpRequest: GET /api/state, POST /api/reset (throwing again)
  const bm = { state: { status: "Throw", event: "Takeout finished", numThrows: 0 }, reqs: [] };
  async function attach(page, scriptText) {
    pages.add(page);
    page.on("close", () => pages.delete(page));
    await page.exposeBinding("__ad2dcXhr", async (_src, method, url) => {
      bm.reqs.push({ t: Date.now(), method, url });
      const m = /^http:\/\/127\.0\.0\.1:3180(\/.*)$/.exec(url);
      if (!m) return { error: "test: no network" };
      if (method === "GET" && m[1] === "/api/state") return { status: 200, text: JSON.stringify(bm.state) };
      if (method === "POST" && m[1] === "/api/reset") { bm.state = { status: "Throw", event: "Manual reset", numThrows: 0 }; return { status: 200, text: "" }; }
      return { status: 404, text: "" };
    });
    await page.exposeBinding("__ad2dcGM", async (_src, op, k, v) => {
      if (op === "init") return JSON.stringify(store);
      if (op === "set") {
        store[k] = v;
        for (const other of pages) if (other !== page && !other.isClosed()) other.evaluate(([kk, vv]) => window.__ad2dcGMPush && window.__ad2dcGMPush(kk, vv), [k, v]).catch(() => {});
      }
      return null;
    });
    await page.addInitScript(`(() => {
  const real = window;
  if (real.__ad2dcHarness) return;
  real.__ad2dcHarness = 1;
  const cache = Object.create(null), listeners = [];
  const parse = j => (j === undefined ? undefined : JSON.parse(j));
  real.__ad2dcGMPush = (k, j) => { const old = cache[k]; cache[k] = j; for (const l of listeners) if (l.k === k) { try { l.fn(k, parse(old), parse(j), true); } catch (e) { console.error(e); } } };
  const GM_getValue = (k, d) => (k in cache ? JSON.parse(cache[k]) : d);
  const GM_setValue = (k, v) => { const old = cache[k], j = JSON.stringify(v); cache[k] = j; real.__ad2dcGM("set", k, j); for (const l of listeners) if (l.k === k) { try { l.fn(k, parse(old), v, false); } catch (e) { console.error(e); } } };
  const GM_addValueChangeListener = (k, fn) => { listeners.push({ k, fn }); return listeners.length; };
  const GM_xmlhttpRequest = d => { real.__ad2dcXhr(d.method || "GET", d.url).then(r => {
    if (r.error) { if (d.onerror) d.onerror({ error: r.error }); } else if (d.onload) d.onload({ status: r.status, responseText: r.text, response: r.text });
  }); };
  const GM_setClipboard = () => {};
  const GM_info = { scriptHandler: "Tampermonkey (test)", version: "5" };
  const proxy = new Proxy(real, {
    get(t, k) { const v = Reflect.get(t, k); return typeof v === "function" && !/^[A-Z]/.test(String(k)) ? v.bind(t) : v; },
    set(t, k, v) { t[k] = v; return true; }
  });
  real.__ad2dcGM("init").then(s => {
    Object.assign(cache, JSON.parse(s));
    (function (window, unsafeWindow, GM_getValue, GM_setValue, GM_addValueChangeListener, GM_xmlhttpRequest, GM_setClipboard, GM_info) {
${scriptText}
    }).call(proxy, proxy, real, GM_getValue, GM_setValue, GM_addValueChangeListener, GM_xmlhttpRequest, GM_setClipboard, GM_info);
  });
})();`);
  }
  return { attach, bm, get: k => (k in store ? JSON.parse(store[k]) : undefined), set: (k, v) => { store[k] = JSON.stringify(v); } };
}

// ---------------- fake Autodarts ----------------
const AD = "https://play.autodarts.io";
const AD_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Autodarts Play</title>
<link rel="modulepreload" href="/assets/src-T1.js"><script type="module" src="/assets/src-T1.js"></script></head>
<body><div id="root">match</div><script>
// the app connects after its bundle and login are ready (well after document-start)
window.addEventListener("load", () => setTimeout(() => {
  const ws = new WebSocket("wss://api.autodarts.io/ms/v0/subscribe");
  ws.addEventListener("open", () => ws.send(JSON.stringify({ channel: "autodarts.matches", type: "subscribe", topic: location.pathname.split("/").pop() + ".state" })));
}, 1200));</script></body></html>`;
const AD_AUTH = `const auth = { getToken: () => "TEST-TOKEN", refreshToken: async () => true }; export { auth as a };`;

export function createAutodarts({ variant = "X01", baseScore = 501 } = {}) {
  let seq = 0;
  const seg = label => {
    const s = String(label).toUpperCase();
    if (s === "M") return { name: "M" + (1 + (seq % 20)), number: 0, bed: "Outside", multiplier: 0 };
    if (s === "25") return { name: "25", number: 25, bed: "SingleOuter", multiplier: 1 };
    if (s === "BULL") return { name: "Bull", number: 25, bed: "Double", multiplier: 2 };
    const m = /^([SDT])(\d+)$/.exec(s), mult = { S: 1, D: 2, T: 3 }[m[1]];
    return { name: s, number: Number(m[2]), bed: ["", "SingleOuter", "Double", "Triple"][mult], multiplier: mult };
  };
  const ad = { id: "m" + Date.now().toString(36), api: [], ws: null, undoMode: "ok", restartMode: "ok", patchMode: "reject", hist: [] };
  const atcTargets = () => { const t = []; for (let n = 1; n <= 20; n++) t.push({ number: n, bed: "Full", hits: 0, count: 0 }); t.push({ number: 25, bed: "Full", hits: 0, count: 0 }); return [t]; };
  const turn = round => ({ id: "turn" + (++seq), playerId: "p1", round, throws: [], points: 0, busted: false });
  ad.m = {
    id: ad.id, variant, type: "Local", players: [{ id: "p1", name: "Ja", userId: "u1", boardId: "b1", cpuPPR: null, index: 0 }],
    settings: variant === "ATC" ? { mode: "Full", order: "1-20-Bull", hits: 1 } : { baseScore, inMode: "Straight", outMode: "Double", bullMode: "25/50", maxRounds: 50 },
    set: 1, leg: 1, round: 1, player: 0, legs: null, sets: null, finished: false, gameFinished: false, winner: -1, scores: null,
    gameScores: [variant === "ATC" ? 0 : baseScore], turns: [turn(1)], state: variant === "ATC" ? { targets: atcTargets(), currentTargets: [0] } : {}
  };
  const snap = () => ad.hist.push(JSON.parse(JSON.stringify(ad.m)));
  ad.send = () => { if (ad.ws) ad.ws.send(JSON.stringify({ channel: "autodarts.matches", topic: ad.id + ".state", data: ad.m })); };
  ad.dart = label => {
    snap();
    const t = { id: "t" + (++seq), segment: seg(label), coords: { x: 0.1, y: -0.2 }, type: "normal" }, s = t.segment, m = ad.m;
    m.turns[0].throws.push(t);
    if (variant === "X01") {
      const rest = m.gameScores[0] - s.number * s.multiplier;
      if (rest === 0 && s.multiplier === 2) { m.gameScores[0] = 0; m.gameFinished = m.finished = true; m.winner = 0; } else if (rest >= 2) m.gameScores[0] = rest;
    } else {
      const st = m.state, ci = st.currentTargets[0], tg = st.targets[0][ci];
      tg.count++;
      if (s.number === tg.number && s.multiplier > 0) {
        tg.hits++;
        if (ci === st.targets[0].length - 1) { m.finished = m.gameFinished = true; m.winner = 0; } else st.currentTargets[0] = ci + 1;
      }
      m.gameScores[0] = st.currentTargets[0];
    }
    ad.send();
  };
  ad.takeout = () => { if (ad.m.finished || ad.m.gameFinished) return; snap(); ad.m.round++; ad.m.turns = [turn(ad.m.round)]; ad.send(); };
  ad.visit = async (labels, gap = 150) => { for (const l of labels) { ad.dart(l); await sleep(gap); } await sleep(250); ad.takeout(); };
  const fresh = nextLeg => {
    ad.hist = [];
    Object.assign(ad.m, { round: 1, finished: false, gameFinished: false, winner: -1, gameScores: [variant === "ATC" ? 0 : baseScore], turns: [turn(1)] });
    if (nextLeg) ad.m.leg++;
    if (variant === "ATC") ad.m.state = { targets: atcTargets(), currentTargets: [0] };
  };
  ad.route = async page => {
    await page.route(AD + "/**", r => new URL(r.request().url()).pathname === "/assets/src-T1.js"
      ? r.fulfill({ status: 200, contentType: "text/javascript", body: AD_AUTH }) : r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: AD_PAGE }));
    await page.routeWebSocket("wss://api.autodarts.io/**", ws => { ad.ws = ws; ws.onMessage(() => {}); setTimeout(() => ad.send(), 200); });
    await page.route(/^https:\/\/api\.autodarts\.(io|com)\//, async r => {
      const req = r.request();
      const cors = { "access-control-allow-origin": AD, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE,PATCH" };
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      const path = new URL(req.url()).pathname.replace(/^\/gs\/v0/, ""), id = ad.id;
      let status = 200;
      if (path === `/matches/${id}/undo`) { if (ad.undoMode === "ok" && ad.hist.length) { ad.m = ad.hist.pop(); setTimeout(ad.send, 40); } else status = 400; }
      else if (path === `/matches/${id}/games/restart`) { if (ad.restartMode === "ok") { fresh(false); setTimeout(ad.send, 80); } else status = 404; }
      else if (path === `/matches/${id}/games/next`) { if (ad.m.finished || ad.m.gameFinished) { fresh(true); setTimeout(ad.send, 80); } else status = 400; }
      else if (path === `/matches/${id}/throws` && req.method() === "PATCH") {
        ad.patchBody = req.postDataJSON();
        if (ad.patchMode !== "accept") status = 400;
        else {
          for (const [i, c] of Object.entries((ad.patchBody || {}).changes || {})) {
            const t = ad.m.turns[0].throws[Number(i)];
            if (t && c.type === "bouncer") { t.segment = { name: "Miss", number: 0, bed: "Outside", multiplier: 0 }; t.entry = "corrected_bouncer"; }
          }
          const st = ad.m.state, tg = st.targets && st.targets[0][st.currentTargets[0]];
          if (tg && ad.m.finished) { tg.hits = 0; ad.m.finished = ad.m.gameFinished = false; ad.m.winner = -1; }
          setTimeout(ad.send, 60);
        }
      }
      else status = 404;
      ad.api.push(req.method() + " " + path.replace(id, "{id}") + " " + status);
      return r.fulfill({ status, headers: Object.assign({ "content-type": "application/json" }, cors), body: "{}" });
    });
  };
  ad.url = () => AD + "/matches/" + ad.id;
  return ad;
}

// ---------------- fake DartCounter ----------------
// X01 local match vs DartBot: markup of the real page (component tags the script reads), score input "Enter a score",
// the DartBot throws 167 per visit, its checkout shows 0 for a moment, then the new leg (both 501, legs counter +1) and the
// app's save to IndexedDB (match.legs[].winner_id, teams[].users[].is_cpu) like the real app after every change of player.
const DC_X01 = `<!doctype html><html><head><meta charset="utf-8"><title>DartCounter</title></head><body>
<div id="board"></div>
<script>
const M = { me: { id: "u-me", rest: 501, legs: 0 }, cpu: { id: "u-cpu", rest: 501, legs: 0 }, legs: [{ id: "1" }], cpuTurn: false };
function save() {
  const rq = indexedDB.open("dartcounter-db", 70);
  rq.onupgradeneeded = () => { const os = rq.result.createObjectStore("unfinishedLocalMatches", { keyPath: "id" }); os.createIndex("started_at", "started_at"); os.createIndex("updated_at", "updated_at"); };
  rq.onsuccess = () => {
    const db = rq.result, tx = db.transaction("unfinishedLocalMatches", "readwrite");
    tx.objectStore("unfinishedLocalMatches").put({ id: "2026-10-31 21:55:17", started_at: "2026-10-31 21:55:17", updated_at: Date.now(), dartbotGraphState: {},
      match: { start_score: 501, is_best_of: true, goal_amount: 5, has_sets: false, vs_cpu: true, legs: M.legs.map(l => Object.assign({}, l)),
        teams: [{ id: "t1", remaining: M.me.rest, total_legs_won_this_set: M.me.legs, users: [{ id: M.me.id, name: "guest_test", is_cpu: false }] },
                { id: "t2", remaining: M.cpu.rest, total_legs_won_this_set: M.cpu.legs, users: [{ id: M.cpu.id, name: "DartBot", is_cpu: true, user: { is_cpu: true, cpu_level: 20 } }] }] } });
    tx.oncomplete = () => db.close();
  };
}
function team(p) { return '<app-match-team-score><app-in-game-interim-score class="block flex-none"><div class="flex flex-row"><div appingameinterimscoresize><span appingameinterimscorelabel>' + p.legs +
  '</span></div></div></app-in-game-interim-score><app-remaining-score> ' + p.rest + ' </app-remaining-score></app-match-team-score>'; }
function render() {
  document.getElementById("board").innerHTML = team(M.me) + team(M.cpu) + (M.cpuTurn ? "" :
    '<app-keyboard-score-input><input type="text" inputmode="numeric" maxlength="3" placeholder="Enter a score"><button class="submit-button" type="button">Submit</button></app-keyboard-score-input>');
  const inp = document.querySelector("app-keyboard-score-input input");
  if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") submit(Number(inp.value)); });
}
function newLeg(winner) {
  M.legs[M.legs.length - 1].winner_id = winner.id; winner.legs++;
  M.legs.push({ id: String(M.legs.length + 1) }); M.me.rest = M.cpu.rest = 501; render(); save();
}
function submit(score) {
  if (!(score >= 0 && score <= 180) || score > M.me.rest - 2) return;
  M.me.rest -= score; M.cpuTurn = true; render(); save();
  setTimeout(() => {
    const s = Math.min(167, M.cpu.rest); M.cpu.rest -= s; render();
    if (M.cpu.rest === 0) setTimeout(() => { M.cpuTurn = false; newLeg(M.cpu); }, 700);
    else setTimeout(() => { M.cpuTurn = false; render(); save(); }, 300);
  }, 400);
}
render(); save();
</script></body></html>`;

// Around the Clock: the real hit keyboard (S/D/T of the target, BULL at the end, undo + Miss), the input with the
// entered darts and Submit; auto-submit after the 3rd dart; "Finish by hitting the bullseye" = BULL key only.
const DC_ATC = `<!doctype html><html><head><meta charset="utf-8"><title>DartCounter</title></head><body><div id="game"></div>
<script>
localStorage.setItem("localAroundTheClockSettings", JSON.stringify({ bullOrBullseye: "bullseye", throwOrder: "low_to_high", numberSegment: "all", hit: "once", increaseGoalByMultiplier: false }));
const G = { target: 1, darts: [], done: false, log: [] };
const key = t => '<button type="button" apprippleeffect="" class="key"> ' + t + ' </button>';
function render() {
  const keys = G.done ? "" : G.target <= 20 ? '<div class="key-wrapper">' + key("S" + G.target) + key("D" + G.target) + key("T" + G.target) + "</div><!---->"
    : '<!----><div class="key-wrapper"><!---->' + key("BULL") + "<!----></div><!---->";
  document.getElementById("game").innerHTML = G.done ? "<app-around-the-clock-local-end-screen-dialog>Finished</app-around-the-clock-local-end-screen-dialog>" :
    '<app-around-the-clock-single-dart-input game-score-input class="block w-full"><app-keyboard-score-input>' +
    G.darts.map(d => '<div><span dctypography="bulevar-40">' + d + "</span></div>").join("") + '<button class="submit-button" type="button">Submit</button></app-keyboard-score-input></app-around-the-clock-single-dart-input>' +
    '<div game-keyboard="" appwebkeyboardcontainer="" class="in-game-keyboard-container">' + keys +
    '<div class="key-wrapper"><button type="button" apprippleeffect="" class="icon-key"><app-icon icon="undo_outline" class="block h-8 w-8"><span class="flex icon-undo_outline"></span></app-icon></button>' +
    '<button type="button" apprippleeffect="" class="key">Miss</button><!----></div></div>';
}
function submitTurn() { G.log.push(G.darts.join(" ")); G.darts = []; render(); }
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || G.done) return;
  const t = b.textContent.trim();
  if (b.classList.contains("submit-button")) { submitTurn(); return; }
  if (b.classList.contains("icon-key")) return;
  if (t === "Miss") G.darts.push("Miss");
  else if (t === "BULL") { G.darts.push("BULL"); G.done = true; G.log.push(G.darts.join(" ")); render(); return; }
  else { G.darts.push(t); G.target++; }
  if (G.darts.length === 3) submitTurn(); else render();
});
window.__atc = G;
render();
</script></body></html>`;

export async function routeDartCounter(page) {
  await page.route("https://app.dartcounter.net/**", r => {
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: p.startsWith("/game/around-the-clock") ? DC_ATC : DC_X01 });
  });
}

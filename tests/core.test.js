// Run: node tests/core.test.js
// Tests the pure logic of the userscript (parser, visit tracker, score decision).
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const Core = require(path.join(__dirname, "..", "autodarts-dartcounter-bridge.user.js"));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
}

const oldT = (name, number, bed, multiplier) => ({ segment: { name, number, bed, multiplier }, coords: { x: 0, y: 0 } });
const newT = (segmentName, segmentNumber, multiplier, bed) => ({ segmentName, segmentNumber, multiplier, bed, coordsX: 0, coordsY: 0, bouncer: false });

test("old nested format", () => {
  const d = Core.normalizeThrow(oldT("T20", 20, "Triple", 3));
  assert.equal(d.label, "T20"); assert.equal(d.score, 60); assert.ok(d.ok);
});
test("new flat format (beta bug: was read as M)", () => {
  const d = Core.normalizeThrow(newT("S12", 12, 1, "SingleInner"));
  assert.equal(d.label, "S12"); assert.equal(d.score, 12); assert.ok(d.ok);
  assert.equal(Core.normalizeThrow(newT("D16", 16, 2, "Double")).score, 32);
});
test("miss", () => {
  const d = Core.normalizeThrow(oldT("M12", 12, "Outside", 0));
  assert.equal(d.label, "M12"); assert.equal(d.score, 0); assert.ok(d.ok);
  assert.equal(Core.normalizeThrow(newT("M5", 5, 0, "Outside")).score, 0);
});
test("bull and 25", () => {
  assert.equal(Core.normalizeThrow(newT("Bull", 25, 2, "Double")).score, 50);
  assert.equal(Core.normalizeThrow(oldT("25", 25, "Single", 1)).score, 25);
  assert.equal(Core.normalizeThrow({ segmentName: "BULL" }).score, 50);
});
test("only a name", () => {
  assert.equal(Core.normalizeThrow({ name: "T19" }).score, 57);
  assert.equal(Core.normalizeThrow("D20").score, 40);
});
test("unknown shape is flagged, not counted as miss", () => {
  const d = Core.normalizeThrow({ foo: 1 });
  assert.equal(d.ok, false);
});
test("missing throws field = empty board", () => {
  const s = Core.normalizeState({ status: "takeoutInProgress", event: "takeoutStarted" });
  assert.equal(s.count, 0); assert.equal(s.throwsMissing, false);
});

function run(states) {
  const visits = [];
  const tr = Core.createTracker(v => visits.push(v.darts.map(d => d.label).join(" ")));
  let t = 1000;
  for (const raw of states) tr.update(Core.normalizeState(raw), (t += 400));
  return visits;
}

test("old format: Throw x3, Takeout, Takeout started/in progress/finished -> 1 visit", () => {
  const a = oldT("T20", 20, "Triple", 3), b = oldT("T20", 20, "Triple", 3), c = oldT("T5", 5, "Triple", 3);
  const v = run([
    { status: "Throw", event: "Started", numThrows: 0 },
    { status: "Throw", event: "Throw detected", numThrows: 1, throws: [a] },
    { status: "Throw", event: "Throw detected", numThrows: 2, throws: [a, b] },
    { status: "Takeout", event: "Throw detected", numThrows: 3, throws: [a, b, c] },
    { status: "Takeout", event: "Throw detected", numThrows: 3, throws: [a, b, c] },
    { status: "Takeout", event: "Takeout started", numThrows: 3, throws: [a, b, c] },
    { status: "Takeout", event: "Takeout in progress", numThrows: 3, throws: [a, b, c] },
    { status: "Throw", event: "Takeout finished", numThrows: 0 }
  ]);
  assert.deepEqual(v, ["T20 T20 T5"]);
});

test("new format: takeoutInProgress repeated, darts disappear one by one -> 1 visit", () => {
  const a = newT("T20", 20, 3, "Triple"), b = newT("S20", 20, 1, "SingleOuter"), c = newT("S5", 5, 1, "SingleInner");
  const pull = { status: "takeoutInProgress", event: "takeoutStarted" };
  const v = run([
    { status: "throw", event: "takeoutFinished" },
    { status: "throw", event: "throwDetected", throws: [a] },
    { status: "throw", event: "throwDetected", throws: [a, b] },
    { status: "takeout", event: "throwDetected", throws: [a, b, c] },
    { ...pull, throws: [a, b, c] }, { ...pull, throws: [a, b, c] }, { ...pull, throws: [a, b, c] },
    { ...pull, throws: [a, b] }, { ...pull, throws: [a] },
    { ...pull }, { ...pull },
    { status: "throw", event: "takeoutFinished", throws: [c] },
    { status: "throw", event: "throwDetected", throws: [c, c] }
  ]);
  assert.deepEqual(v, ["T20 S20 S5"]);
});

test("lingering takeout status on the first dart of the next visit does not end it", () => {
  const a = newT("S1", 1, 1, "SingleInner"), b = newT("T20", 20, 3, "Triple");
  const v = run([
    { status: "throw", throws: [a] },
    { status: "takeoutInProgress", throws: [a] },
    { status: "takeoutInProgress" },
    { status: "takeoutInProgress", throws: [b] },
    { status: "throw", throws: [b, b] },
    { status: "takeoutInProgress", throws: [b, b] },
    { status: "takeoutInProgress" }
  ]);
  assert.deepEqual(v, ["S1", "T20 T20"]);
});

test("same snapshot polled many times -> 1 visit", () => {
  const a = newT("T20", 20, 3, "Triple");
  const s = [{ status: "throw" }];
  for (let i = 0; i < 3; i++) s.push({ status: "throw", throws: [a, a, a] });
  for (let i = 0; i < 20; i++) s.push({ status: "takeoutInProgress", throws: [a, a, a] });
  for (let i = 0; i < 5; i++) s.push({ status: "takeoutInProgress" });
  assert.deepEqual(run(s), ["T20 T20 T20"]);
});

test("visit with 2 darts ended by removal (finish)", () => {
  const a = newT("T20", 20, 3, "Triple"), d = newT("D20", 20, 2, "Double");
  assert.deepEqual(run([{ status: "throw" }, { status: "throw", throws: [a] }, { status: "throw", throws: [a, d] }, { status: "throw" }]), ["T20 D20"]);
});

test("connected while darts are being pulled -> not sent", () => {
  const a = newT("T20", 20, 3, "Triple");
  assert.deepEqual(run([{ status: "takeoutInProgress", throws: [a, a, a] }, { status: "takeoutInProgress" }]), []);
});

test("correction of a dart before takeout uses the corrected value", () => {
  const a = newT("S1", 1, 1, "SingleInner"), a2 = newT("T20", 20, 3, "Triple");
  assert.deepEqual(run([{ status: "throw" }, { status: "throw", throws: [a, a, a] }, { status: "throw", throws: [a2, a, a] }, { status: "takeoutInProgress", throws: [a2, a, a] }, { status: "throw" }]), ["T20 S1 S1"]);
});

test("nothing is sent while the darts stay in the board (any state, any time)", () => {
  const a = newT("T20", 20, 3, "Triple");
  const s = [{ status: "throw" }, { status: "throw", throws: [a, a, a] }];
  for (let i = 0; i < 50; i++) s.push({ status: "takeout", event: "throwDetected", throws: [a, a, a] });
  for (let i = 0; i < 50; i++) s.push({ status: "throw", event: "throwDetected", throws: [a, a, a] });
  assert.deepEqual(run(s), []);
});

test("nothing is sent during the takeout, only after it", () => {
  const a = newT("T20", 20, 3, "Triple");
  const pull = { status: "takeoutInProgress", event: "takeoutStarted" };
  assert.deepEqual(run([{ status: "throw" }, { status: "throw", throws: [a, a, a] }, { ...pull, throws: [a, a, a] }, { ...pull, throws: [a, a] }]), []);
  assert.deepEqual(run([{ status: "throw" }, { status: "throw", throws: [a, a, a] }, { ...pull, throws: [a, a, a] }, { ...pull, throws: [a] }, { ...pull }]), ["T20 T20 T20"]);
});

test("takeout over and state back to throw while darts still listed -> sent once", () => {
  const a = newT("T19", 19, 3, "Triple");
  const v = run([{ status: "throw" }, { status: "throw", throws: [a, a, a] },
    { status: "takeoutInProgress", event: "takeoutStarted", throws: [a, a, a] },
    { status: "throw", event: "takeoutFinished", throws: [a, a, a] },
    { status: "throw", event: "takeoutFinished", throws: [a, a, a] },
    { status: "throw", event: "takeoutFinished" }]);
  assert.deepEqual(v, ["T19 T19 T19"]);
});

test("visit id is unique per visit", () => {
  const ids = [];
  const tr = Core.createTracker(v => ids.push(v.id));
  const a = newT("T20", 20, 3, "Triple");
  let t = 0;
  for (let k = 0; k < 2; k++) for (const raw of [{ status: "throw" }, { status: "throw", throws: [a, a, a] }, { status: "takeoutInProgress", throws: [a, a, a] }, { status: "throw" }]) tr.update(Core.normalizeState(raw), (t += 400));
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]);
});

// ---------- corrections (3.1.0) ----------
function runWith(states, edits) {
  // edits: { afterIndex: [[slot, label|null|undefined], ...] }
  const visits = [];
  const tr = Core.createTracker(v => visits.push(v));
  let t = 1000;
  states.forEach((raw, i) => {
    tr.update(Core.normalizeState(raw), (t += 400));
    for (const [slot, lbl] of (edits[i] || [])) tr.setOverride(slot, lbl == null ? lbl : Core.normalizeThrow(lbl));
  });
  return visits;
}
const lbls = v => v.darts.map(d => d.label).join(" ");

test("correction before takeout wins over /api/state (4 -> 18)", () => {
  const s4 = newT("S4", 4, 1, "SingleInner"), t20 = newT("T20", 20, 3, "Triple");
  const v = runWith([{ status: "throw" }, { status: "throw", throws: [t20] }, { status: "throw", throws: [t20, s4] },
    { status: "throw", throws: [t20, s4, t20] }, { status: "takeoutInProgress", throws: [t20, s4, t20] }, { status: "takeoutInProgress" }],
  { 2: [[1, "S18"]] });
  assert.equal(v.length, 1);
  assert.equal(lbls(v[0]), "T20 S18 T20");
  assert.equal(v[0].darts.reduce((a, d) => a + d.score, 0), 138);
  assert.equal(v[0].corrected, true);
  assert.equal(v[0].detected.map(d => d.label).join(" "), "T20 S4 T20");
});

test("correction stays when AutoDarts re-sends the same visit", () => {
  const s4 = newT("S4", 4, 1, "SingleInner");
  const s = [{ status: "throw" }, { status: "throw", throws: [s4] }];
  for (let i = 0; i < 10; i++) s.push({ status: "throw", throws: [s4] });
  s.push({ status: "throw" });
  const v = runWith(s, { 1: [[0, "D18"]] });
  assert.deepEqual(v.map(lbls), ["D18"]);
});

test("correction does not leak into the next visit", () => {
  const a = newT("S4", 4, 1, "SingleInner");
  const v = runWith([{ status: "throw" }, { status: "throw", throws: [a] }, { status: "throw" }, { status: "throw", throws: [a] }, { status: "throw" }],
    { 1: [[0, "S18"]] });
  assert.deepEqual(v.map(lbls), ["S18", "S4"]);
});

test("missed dart can be added, ghost dart removed, 'back to AutoDarts' restores", () => {
  const a = newT("T20", 20, 3, "Triple");
  const v = runWith([{ status: "throw" }, { status: "throw", throws: [a, a] }, { status: "throw", throws: [a, a] }, { status: "throw" }],
    { 1: [[2, "BULL"], [1, null]], 2: [[1, undefined]] });
  assert.deepEqual(v.map(lbls), ["T20 T20 BULL"]);
});

test("removing every dart sends nothing", () => {
  const a = newT("T20", 20, 3, "Triple");
  const v = runWith([{ status: "throw" }, { status: "throw", throws: [a] }, { status: "throw" }], { 1: [[0, null]] });
  assert.deepEqual(v, []);
});

test("correction values: 25, Bull, miss", () => {
  assert.equal(Core.normalizeThrow("25").score, 25);
  assert.equal(Core.normalizeThrow("BULL").score, 50);
  const m = Core.normalizeThrow("M");
  assert.equal(m.score, 0); assert.equal(m.ok, true); assert.equal(m.label, "M");
});

// ---------- source "gra": Autodarts match state (3.1.0) ----------
const seg = (name, number, multiplier, bed) => ({ segment: { name, number, multiplier, bed }, coords: { x: 0, y: 0 } });
const P = [{ id: "p1", name: "Player 1" }];
function match(round, throws, extra) {
  return Object.assign({ id: "m1", variant: "X01", players: P, player: 0, round, set: 0, leg: 0, turns: [{ round, playerId: "p1", throws }] }, extra || {});
}
function runMatch(states) {
  const out = [];
  const tr = Core.createMatchTracker(v => out.push(v.darts.map(d => d.label).join(" ")));
  for (const m of states) tr.update(Core.parseMatch(m));
  return out;
}
const T20 = seg("T20", 20, 3, "Triple"), S4 = seg("S4", 4, 1, "SingleInner"), S18 = seg("S18", 18, 1, "SingleInner"), S1 = seg("S1", 1, 1, "SingleOuter");

test("parseMatch: current turn, key, bull as 50", () => {
  const m = Core.parseMatch(match(3, [seg("Bull", 50, 1, "Bull"), T20]));
  assert.equal(m.key, "0.0.3.0");
  assert.equal(m.darts.map(d => d.label).join(" "), "BULL T20");
  assert.equal(m.darts[0].score, 50);
  const hist = Core.parseMatch({ id: "m1", players: P, player: 0, round: 2, turns: [{ round: 1, playerId: "p1", throws: [S1] }, { round: 2, playerId: "p1", throws: [T20] }] });
  assert.equal(hist.darts[0].label, "T20");
  assert.equal(Core.parseMatch({ body: 1 }), null);
});

test("game: turn sent once when the next turn starts, with the correction made in the game", () => {
  const v = runMatch([match(1, []), match(1, [T20]), match(1, [T20, S4]), match(1, [T20, S18]), match(1, [T20, S18, S1]),
    match(1, [T20, S18, S1]), match(2, []), match(2, []), match(2, [T20])]);
  assert.deepEqual(v, ["T20 S18 S1"]);
});

test("game: nothing is sent while the turn is still open", () => {
  const s = [match(1, [])];
  for (let i = 0; i < 30; i++) s.push(match(1, [T20, T20, T20]));
  assert.deepEqual(runMatch(s), []);
});

test("game: finished leg sends once, the following new leg does not resend", () => {
  const v = runMatch([match(5, [seg("D20", 20, 2, "Double")]), match(5, [seg("D20", 20, 2, "Double")], { gameFinished: true }),
    match(5, [seg("D20", 20, 2, "Double")], { gameFinished: true }), match(1, [], { leg: 1 })]);
  assert.deepEqual(v, ["D20"]);
});

test("game: undo back into a sent turn sends nothing more", () => {
  const v = runMatch([match(1, [T20]), match(2, []), match(2, [S1]), match(1, [T20]), match(1, [T20, S4]), match(2, [])]);
  assert.deepEqual(v, ["T20"]);
});

test("game: single undo to zero darts is accepted, a sudden jump to zero keeps the darts", () => {
  assert.deepEqual(runMatch([match(1, []), match(1, [S1]), match(1, []), match(2, [])]), []);
  assert.deepEqual(runMatch([match(1, []), match(1, [T20, T20, S1]), match(1, []), match(2, [])]), ["T20 T20 S1"]);
});

test("game: joined mid-turn sends it at the end; joined on a finished leg sends nothing; new match drops the old turn", () => {
  assert.deepEqual(runMatch([match(4, [T20, T20]), match(4, [T20, T20, T20]), match(5, [])]), ["T20 T20 T20"]);
  assert.deepEqual(runMatch([match(4, [T20], { gameFinished: true }), match(1, [], { leg: 1 })]), []);
  assert.deepEqual(runMatch([match(4, [T20]), Object.assign(match(1, []), { id: "m2" })]), []);
});

// ---------- dart sounds (3.3.0) ----------
// steps: [turnKey, [labels...]] snapshots; returns the sounds in order
function sounds(steps) {
  const out = [];
  const r = Core.createSoundRules(name => out.push(name));
  for (const [key, labels] of steps) r.update(key, labels.map(l => Core.normalizeThrow(l)), key === "local");
  return out;
}
// one turn thrown dart by dart, then the next turn starts (turn end)
function turnSounds(labels) {
  const steps = [["t0", []]];
  for (let i = 1; i <= labels.length; i++) steps.push(["t1", labels.slice(0, i)]);
  steps.push(["t2", []]);
  return sounds(steps);
}

test("dart -> sound: S1/D1/T1 laugh, T20 cheer, miss boo, others none", () => {
  const ds = l => Core.dartSound(Core.normalizeThrow(l));
  assert.equal(ds("S1"), "laugh"); assert.equal(ds("D1"), "laugh"); assert.equal(ds("T1"), "laugh");
  assert.equal(ds("T20"), "cheer");
  assert.equal(ds("M12"), "boo"); assert.equal(ds("Miss"), "boo");
  for (const l of ["S20", "D20", "S5", "T19", "BULL", "25", "D16", "S11"]) assert.equal(ds(l), null, l);
  assert.equal(Core.dartSound(Core.normalizeThrow({ foo: 1 })), null);
  assert.equal(Core.dartSound(Core.normalizeThrow(newT("M7", 7, 0, "Outside"))), "boo");
});

test("sounds: one per dart, in throw order", () => {
  assert.deepEqual(turnSounds(["T20", "M3", "D1"]), ["cheer", "boo", "laugh"]);
  assert.deepEqual(turnSounds(["T1", "S19", "T20"]), ["laugh", "cheer"]);
  assert.deepEqual(turnSounds(["S20", "S5", "S19"]), []);
});

test("combo S1 + S5 + S20 in any order: combo only, no laugh", () => {
  const perms = [["S1", "S5", "S20"], ["S1", "S20", "S5"], ["S5", "S1", "S20"], ["S5", "S20", "S1"], ["S20", "S1", "S5"], ["S20", "S5", "S1"]];
  for (const p of perms) assert.deepEqual(turnSounds(p), ["combo"], p.join(" "));
});

test("combo has priority: S1 laugh waits while the combo is possible", () => {
  const steps = [["t0", []], ["t1", ["S1"]]];
  assert.deepEqual(sounds(steps), []); // S1 thrown: nothing yet
  assert.deepEqual(sounds([...steps, ["t1", ["S1", "S5"]]]), []);
  assert.deepEqual(sounds([...steps, ["t1", ["S1", "S5"]], ["t1", ["S1", "S5", "S20"]]]), ["combo"]);
});

test("combo broken: the waiting S1 laugh plays then (or the newer dart's own sound)", () => {
  assert.deepEqual(turnSounds(["S1", "S5", "S19"]), ["laugh"]);   // laugh plays at the 3rd dart
  assert.deepEqual(turnSounds(["S1", "T20"]), ["cheer"]);         // newer sound wins (one sound at a time)
  assert.deepEqual(turnSounds(["S1", "M4"]), ["boo"]);
  assert.deepEqual(turnSounds(["S1", "S5"]), ["laugh"]);          // turn ended with 2 darts: laugh at turn end
  assert.deepEqual(turnSounds(["D1", "S5", "S20"]), ["laugh"]);   // D1 is not part of the combo
  assert.deepEqual(turnSounds(["S1", "S1"]), ["laugh"]);
});

test("sounds: repeated snapshots and the starting state are silent", () => {
  assert.deepEqual(sounds([["t1", ["T20", "M1"]], ["t1", ["T20", "M1"]], ["t1", ["T20", "M1"]]]), []);
  assert.deepEqual(sounds([["t0", []], ["t1", ["T20"]], ["t1", ["T20"]], ["t1", ["T20"]]]), ["cheer"]);
});

test("sounds: undo of S1 cancels its waiting laugh; local board empty ends the turn", () => {
  assert.deepEqual(sounds([["t0", []], ["t1", ["S1"]], ["t1", []], ["t2", []]]), []);
  assert.deepEqual(sounds([["local", []], ["local", ["S5"]], ["local", ["S5", "S1"]], ["local", []]]), ["laugh"]);
  assert.deepEqual(sounds([["local", []], ["local", ["S5", "S20", "S1"]], ["local", []], ["local", ["T20"]]]), ["combo", "cheer"]);
});

// ---------- bull fireworks (3.4.0) ----------
test("bullKind: bullseye 50 -> big, outer bull 25 -> small, everything else none", () => {
  const bk = x => Core.bullKind(Core.normalizeThrow(x));
  assert.equal(bk("BULL"), "big"); assert.equal(bk("D25"), "big"); assert.equal(bk("DB"), "big"); assert.equal(bk("50"), "big");
  assert.equal(bk("25"), "small"); assert.equal(bk("S25"), "small"); assert.equal(bk("SB"), "small");
  assert.equal(bk(newT("Bull", 25, 2, "Double")), "big");                    // new /api/state format
  assert.equal(bk(newT("25", 25, 1, "Single")), "small");
  assert.equal(bk(oldT("Bull", 25, "Double", 2)), "big");                    // old /api/state format
  assert.equal(bk(oldT("25", 25, "Single", 1)), "small");
  assert.equal(bk(seg("Bull", 50, 1, "Bull")), "big");                       // match state may say 50
  assert.equal(bk(seg("25", 25, 1, "Single")), "small");
  for (const x of ["S20", "T20", "D20", "S5", "M25", "Miss", "T19"]) assert.equal(bk(x), null, x);
  assert.equal(Core.bullKind(Core.normalizeThrow({ foo: 1 })), null);
  assert.equal(Core.bullKind(null), null);
});

function bulls(steps) {
  const out = [];
  const nd = Core.createNewDarts(d => { const k = Core.bullKind(d); if (k) out.push(k); });
  for (const [key, labels] of steps) nd.update(key, labels.map(l => Core.normalizeThrow(l)));
  return out;
}
test("fireworks once per new bull: big for 50, small for 25, repeats and the start state stay quiet", () => {
  assert.deepEqual(bulls([["t1", ["BULL"]], ["t1", ["BULL"]]]), []);                                  // already there at start
  assert.deepEqual(bulls([["t1", []], ["t1", ["BULL"]], ["t1", ["BULL"]], ["t1", ["BULL", "25"]], ["t1", ["BULL", "25"]]]), ["big", "small"]);
  assert.deepEqual(bulls([["t1", []], ["t1", ["T20", "S1", "D16"]]]), []);
  assert.deepEqual(bulls([["t1", []], ["t1", ["25", "BULL", "BULL"]]]), ["small", "big", "big"]);    // three new in one update
});
test("fireworks: next turn and undo", () => {
  assert.deepEqual(bulls([["t1", []], ["t1", ["BULL"]], ["t2", ["BULL"]]]), ["big", "big"]);         // new turn, new bull
  assert.deepEqual(bulls([["t1", []], ["t1", ["BULL"]], ["t1", []], ["t1", ["25"]]]), ["big", "small"]); // undo, thrown again
  assert.deepEqual(bulls([["t1", []], ["t1", ["S5"]], ["t1", ["BULL"]]]), []);                          // correction at the same place
  assert.deepEqual(bulls([["local", []], ["local", ["S1", "S1", "S1"]], ["local", []], ["local", ["BULL"]]]), ["big"]);
});

// ---------- Around the Clock (3.5.0) ----------
test("ATC DartCounter settings: classic 1-20 + bullseye supported, others skipped with a reason", () => {
  assert.equal(Core.atcDcConfig(null).ok, true);                                  // DartCounter defaults
  const c = Core.atcDcConfig({ bullOrBullseye: "bullseye", throwOrder: "low_to_high", numberSegment: "all", hit: "once", increaseGoalByMultiplier: false });
  assert.equal(c.ok, true); assert.equal(c.throwout, "bullseye"); assert.equal(c.segment, "all"); assert.equal(c.hits, "once");
  for (const bad of [{ throwOrder: "high_to_low" }, { throwOrder: "random" }, { increaseGoalByMultiplier: true }, { numberSegment: "single_big" }, { numberSegment: "single_small" }]) {
    const r = Core.atcDcConfig(bad);
    assert.equal(r.ok, false, JSON.stringify(bad)); assert.ok(r.why.length > 5);
  }
  assert.equal(Core.atcDcConfig({ numberSegment: "double", hit: "thrice", bullOrBullseye: "all" }).ok, true);
});

test("ATC Autodarts settings: 1-20-Bull with matching mode/hits only", () => {
  const dc = Core.atcDcConfig(null);
  assert.equal(Core.atcAutodartsCheck({ order: "1-20-Bull", mode: "Full", hits: 1 }, dc).ok, true);
  assert.equal(Core.atcAutodartsCheck(null, dc).ok, true);                         // local board: DartCounter decides
  assert.equal(Core.atcAutodartsCheck({ order: "20-1-Bull", mode: "Full", hits: 1 }, dc).ok, false);
  assert.equal(Core.atcAutodartsCheck({ order: "Random-Bull", mode: "Full", hits: 1 }, dc).ok, false);
  assert.equal(Core.atcAutodartsCheck({ order: "1-20-Bull", mode: "Outer Single", hits: 1 }, dc).ok, false);
  assert.equal(Core.atcAutodartsCheck({ order: "1-20-Bull", mode: "Double", hits: 1 }, dc).ok, false);   // DartCounter "all"
  assert.equal(Core.atcAutodartsCheck({ order: "1-20-Bull", mode: "Full", hits: 2 }, dc).ok, false);     // DartCounter "once"
  assert.equal(Core.atcAutodartsCheck({ order: "1-20-Bull", mode: "Double", hits: 3 }, Core.atcDcConfig({ numberSegment: "double", hit: "thrice" })).ok, true);
});

test("ATC dart -> DartCounter key (classic: S/D/T all count, one target per hit, bull 50 at the end)", () => {
  const cfg = Core.atcDcConfig(null), k = (l, t) => Core.atcKey(Core.normalizeThrow(l), t, cfg);
  const seven = { kind: "number", n: 7 }, bull = { kind: "bull" };
  assert.equal(k("S7", seven), "S"); assert.equal(k("D7", seven), "D"); assert.equal(k("T7", seven), "T");
  for (const l of ["S8", "T17", "M7", "25", "BULL"]) assert.equal(k(l, seven), "miss", l);
  assert.equal(k("BULL", bull), "bull");              // 50 finishes
  assert.equal(k("25", bull), "miss");                // outer bull does not count with "Finish by hitting the bullseye"
  assert.equal(k("S20", bull), "miss"); assert.equal(k("M3", bull), "miss");
  assert.equal(Core.atcKey(Core.normalizeThrow({ foo: 1 }), seven, cfg), "miss");
});

test("ATC dart -> key for other DartCounter settings (single bull, either bull, segment-only)", () => {
  const bull = { kind: "bull" }, seven = { kind: "number", n: 7 };
  const sb = Core.atcDcConfig({ bullOrBullseye: "bull" }), either = Core.atcDcConfig({ bullOrBullseye: "all" }), dbl = Core.atcDcConfig({ numberSegment: "double" });
  assert.equal(Core.atcKey(Core.normalizeThrow("25"), bull, sb), "bull"); assert.equal(Core.atcKey(Core.normalizeThrow("BULL"), bull, sb), "miss");
  assert.equal(Core.atcKey(Core.normalizeThrow("25"), bull, either), "singlebull"); assert.equal(Core.atcKey(Core.normalizeThrow("BULL"), bull, either), "bullseye");
  assert.equal(Core.atcKey(Core.normalizeThrow("D7"), seven, dbl), "hit"); assert.equal(Core.atcKey(Core.normalizeThrow("S7"), seven, dbl), "miss");
});

test("visit goes only to the matching DartCounter game (X01 vs ATC)", () => {
  assert.equal(Core.visitFits("X01", "x01"), true); assert.equal(Core.visitFits("ATC", "atc"), true);
  assert.equal(Core.visitFits("ATC", "x01"), false); assert.equal(Core.visitFits("X01", "atc"), false);
  assert.equal(Core.visitFits("Cricket", "x01"), false);
  assert.equal(Core.visitFits("", "x01"), true); assert.equal(Core.visitFits(undefined, "atc"), true); // local board
});

test("parseMatch keeps the ATC settings for the bridge", () => {
  const m = Core.parseMatch({ id: "a1", variant: "ATC", settings: { order: "1-20-Bull", mode: "Full", hits: 1 }, players: P, player: 0, round: 1, turns: [{ round: 1, playerId: "p1", throws: [seg("S1", 1, 1, "SingleInner")] }] });
  assert.equal(m.variant, "ATC"); assert.deepEqual(m.settings, { order: "1-20-Bull", mode: "Full", hits: 1 });
  const out = [];
  const tr = Core.createMatchTracker(v => out.push(v));
  tr.update(m); tr.update(Core.parseMatch({ id: "a1", variant: "ATC", settings: { order: "1-20-Bull", mode: "Full", hits: 1 }, players: P, player: 0, round: 2, turns: [{ round: 2, playerId: "p1", throws: [] }] }));
  assert.equal(out.length, 1); assert.equal(out[0].variant, "ATC"); assert.equal(out[0].settings.order, "1-20-Bull");
});

const D = (lbl) => Core.normalizeThrow(lbl);
test("decideScore: normal, unknown remaining", () => {
  assert.equal(Core.decideScore([D("T20"), D("T20"), D("T20")], null, false, true).score, 180);
  assert.equal(Core.decideScore([D("T20"), D("S5"), D("S1")], 501, true, true).score, 66);
});
test("decideScore: bust with reliable remaining", () => {
  assert.equal(Core.decideScore([D("T20")], 40, true, true).score, 0);
  assert.equal(Core.decideScore([D("S19")], 20, true, true).score, 0); // leaves 1
});
test("decideScore: finish on double / not on double", () => {
  assert.equal(Core.decideScore([D("S20"), D("D10")], 40, true, true).score, 40);
  assert.equal(Core.decideScore([D("S20"), D("S20")], 40, true, true).score, 0);
  assert.equal(Core.decideScore([D("S20"), D("S20")], 40, true, false).score, 40);
  assert.equal(Core.decideScore([D("BULL")], 50, true, true).score, 50);
});
test("decideScore: guessed remaining only blocks finish without double, busts left to DartCounter", () => {
  assert.equal(Core.decideScore([D("T20")], 40, false, true).score, 60);
  assert.equal(Core.decideScore([D("S20"), D("S20")], 40, false, true).score, 0);
});

if (failed) { console.log(failed + " test(s) failed"); process.exit(1); }
console.log("all core tests passed");

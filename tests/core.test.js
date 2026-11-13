import test from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  audit,
  deferred,
  enumerate,
  analyze,
  example,
} from "../core.js";

test("two independent preference cycles yield four stable outcomes", () => {
  const result = analyze(example);
  assert.equal(result.alternatives.stable.length, 4);
  assert.deepEqual(result.residents.assignment, {
    Ada: "Cedar",
    Ben: "Dune",
    Cy: "Elm",
    Dee: "Fjord",
    Eli: "Cedar",
    Flo: null,
  });
  assert.deepEqual(result.programs.assignment, {
    Ada: "Dune",
    Ben: "Cedar",
    Cy: "Fjord",
    Dee: "Elm",
    Eli: "Cedar",
    Flo: null,
  });
  assert.deepEqual(result.alternatives.possible.Flo, [null]);
  assert.deepEqual(result.alternatives.possible.Eli, ["Cedar"]);
});
test("blocking pairs identify vacant seats and preferred replacements", () => {
  const blank = Object.fromEntries(example.residents.map((r) => [r.id, null]));
  assert.equal(audit(example, blank).blocking.length, 10);
  const assignment = deferred(example).assignment;
  assignment.Eli = null;
  assignment.Flo = "Cedar";
  assert.ok(
    audit(example, assignment).blocking.some(
      (x) => x.resident === "Eli" && x.displaces.includes("Flo"),
    ),
  );
  assignment.Eli = "Cedar";
  assert.match(audit(example, assignment).issues[0], /capacity/);
});
test("one-sided acceptability, empty lists and unmatched seats", () => {
  const model = {
    residents: [
      { id: "A", prefs: ["X"] },
      { id: "B", prefs: [] },
    ],
    hospitals: [{ id: "X", capacity: 2, prefs: ["B"] }],
  };
  for (const side of ["residents", "programs"])
    assert.deepEqual(deferred(model, side).assignment, { A: null, B: null });
  assert.equal(enumerate(model).stable.length, 1);
});
test("every proposal snapshot is feasible and offers never repeat", () => {
  for (const side of ["residents", "programs"]) {
    const run = deferred(example, side);
    const pairs = new Set();
    for (const step of run.steps) {
      assert.equal(audit(example, step.assignment).issues.length, 0);
      if (step.proposal) {
        const key = JSON.stringify(step.proposal);
        assert.equal(pairs.has(key), false);
        pairs.add(key);
      }
    }
    assert.ok(run.audit.stable);
    assert.ok(run.steps.length <= 25);
  }
});
test("strict schema bounds reject invalid preferences and assignments", () => {
  for (const raw of [
    {},
    { ...example, residents: [...example.residents, example.residents[0]] },
    {
      ...example,
      hospitals: example.hospitals.map((h) => ({ ...h, capacity: 0 })),
    },
    { ...example, residents: [{ id: "X", prefs: ["missing"] }] },
    { ...example, residents: [{ id: "X", prefs: ["Cedar", "Cedar"] }] },
  ])
    assert.throws(() => validate(raw));
  assert.equal(audit(example, {}).stable, false);
  const bad = deferred(example).assignment;
  bad.Ada = "Elm";
  assert.match(audit(example, bad).issues[0], /unacceptable/);
});
// Independent oracle: enumerate every assignment as a base-(programs+1) number,
// then compare all mutually acceptable pairs using explicit preference ranks.
function oracle(m) {
  const found = [];
  const base = m.hospitals.length + 1;
  for (let code = 0; code < base ** m.residents.length; code++) {
    let digits = code;
    const choices = m.residents.map(() => {
      const d = digits % base;
      digits = Math.floor(digits / base);
      return d - 1;
    });
    if (
      m.hospitals.some(
        (h, j) => choices.filter((x) => x === j).length > h.capacity,
      )
    )
      continue;
    if (
      m.residents.some(
        (r, i) =>
          choices[i] >= 0 &&
          (!r.prefs.includes(m.hospitals[choices[i]].id) ||
            !m.hospitals[choices[i]].prefs.includes(r.id)),
      )
    )
      continue;
    let blocked = false;
    for (let i = 0; i < m.residents.length; i++)
      for (let j = 0; j < m.hospitals.length; j++) {
        const r = m.residents[i],
          h = m.hospitals[j],
          rRank = r.prefs.indexOf(h.id),
          hRank = h.prefs.indexOf(r.id);
        if (rRank < 0 || hRank < 0 || choices[i] === j) continue;
        const improves =
            choices[i] < 0 ||
            rRank < r.prefs.indexOf(m.hospitals[choices[i]].id),
          incumbents = choices.flatMap((v, k) => (v === j ? [k] : []));
        if (
          improves &&
          (incumbents.length < h.capacity ||
            incumbents.some((k) => hRank < h.prefs.indexOf(m.residents[k].id)))
        )
          blocked = true;
      }
    if (!blocked)
      found.push(
        Object.fromEntries(
          m.residents.map((r, i) => [
            r.id,
            choices[i] < 0 ? null : m.hospitals[choices[i]].id,
          ]),
        ),
      );
  }
  return found;
}
test("200 random markets match exhaustive oracle and resident-optimal bounds", () => {
  let seed = 73;
  const rand = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % n;
  };
  const shuffle = (items) => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, rand(a.length + 1));
  };
  for (let trial = 0; trial < 200; trial++) {
    const rids = Array.from({ length: 1 + rand(5) }, (_, i) => `r${i}`),
      hids = Array.from({ length: 1 + rand(3) }, (_, i) => `h${i}`);
    const m = {
      residents: rids.map((id) => ({ id, prefs: shuffle(hids) })),
      hospitals: hids.map((id) => ({
        id,
        capacity: 1 + rand(3),
        prefs: shuffle(rids),
      })),
    };
    const actual = analyze(m),
      expected = oracle(m);
    const signatures = (xs) => xs.map((x) => JSON.stringify(x)).sort();
    assert.deepEqual(
      signatures(actual.alternatives.stable),
      signatures(expected),
    );
    assert.ok(expected.length > 0);
    for (const side of ["residents", "programs"])
      assert.ok(
        expected.some(
          (x) => JSON.stringify(x) === JSON.stringify(actual[side].assignment),
        ),
      );
    for (const matching of expected)
      for (const r of m.residents) {
        const rank = (h) => (h === null ? Infinity : r.prefs.indexOf(h));
        assert.ok(
          rank(actual.residents.assignment[r.id]) <= rank(matching[r.id]),
        );
        assert.ok(
          rank(actual.programs.assignment[r.id]) >= rank(matching[r.id]),
        );
      }
    for (const matching of expected) {
      for (const r of rids)
        assert.equal(
          matching[r] === null,
          actual.residents.assignment[r] === null,
        );
      for (const h of hids)
        assert.equal(
          Object.values(matching).filter((x) => x === h).length,
          Object.values(actual.residents.assignment).filter((x) => x === h)
            .length,
        );
    }
  }
});

test("largest complete market enumerates all capacity-feasible assignments", () => {
  const residents = Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`,
    prefs: ["h0", "h1", "h2", "h3"],
  }));
  const hospitals = Array.from({ length: 4 }, (_, i) => ({
    id: `h${i}`,
    capacity: 3,
    prefs: residents.map((r) => r.id).toReversed(),
  }));
  const result = analyze({ residents, hospitals });
  assert.equal(result.alternatives.feasible, 14565);
  assert.equal(result.alternatives.stable.length, 1);
  assert.deepEqual(result.residents.assignment, {
    r0: "h1",
    r1: "h1",
    r2: "h1",
    r3: "h0",
    r4: "h0",
    r5: "h0",
  });
});

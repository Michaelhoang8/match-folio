export function validate(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray(raw.residents) ||
    !Array.isArray(raw.hospitals) ||
    raw.residents.length < 1 ||
    raw.residents.length > 6 ||
    raw.hospitals.length < 1 ||
    raw.hospitals.length > 4
  )
    throw Error("Use 1–6 residents and 1–4 programs.");
  const rids = raw.residents.map((r) => r.id),
    hids = raw.hospitals.map((h) => h.id),
    ids = [...rids, ...hids];
  if (
    ids.some((id) => typeof id !== "string" || !/^\w{1,16}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    throw Error(
      "All participant IDs must be distinct ASCII names of 1–16 letters, digits, or underscores.",
    );
  function prefs(value, allowed) {
    if (
      !Array.isArray(value) ||
      value.some((id) => !allowed.includes(id)) ||
      new Set(value).size !== value.length
    )
      throw Error(
        "Preferences must be strict lists of known IDs without duplicates.",
      );
    return [...value];
  }
  return {
    residents: raw.residents.map((r) => ({
      id: r.id,
      prefs: prefs(r.prefs, hids),
    })),
    hospitals: raw.hospitals.map((h) => {
      if (!Number.isInteger(h.capacity) || h.capacity < 1 || h.capacity > 3)
        throw Error("Program capacities must be integers from 1 to 3.");
      return { id: h.id, capacity: h.capacity, prefs: prefs(h.prefs, rids) };
    }),
  };
}
const blank = (model) =>
  Object.fromEntries(model.residents.map((r) => [r.id, null]));
const members = (assignment, h) =>
  Object.keys(assignment).filter((r) => assignment[r] === h);
export function audit(raw, assignment) {
  const model = validate(raw),
    issues = [],
    blocking = [];
  if (
    !assignment ||
    typeof assignment !== "object" ||
    Array.isArray(assignment) ||
    Object.keys(assignment).sort().join(",") !==
      model.residents
        .map((r) => r.id)
        .sort()
        .join(",")
  )
    return {
      stable: false,
      issues: ["Assignment must contain every resident exactly once."],
      blocking: [],
    };
  for (const r of model.residents) {
    const h = model.hospitals.find((h) => h.id === assignment[r.id]);
    if (
      assignment[r.id] !== null &&
      (!h || !r.prefs.includes(h.id) || !h.prefs.includes(r.id))
    )
      issues.push(`${r.id} has an unacceptable assignment.`);
  }
  for (const h of model.hospitals)
    if (members(assignment, h.id).length > h.capacity)
      issues.push(`${h.id} exceeds capacity.`);
  if (issues.length) return { stable: false, issues, blocking };
  for (const r of model.residents)
    for (const h of model.hospitals) {
      if (
        !r.prefs.includes(h.id) ||
        !h.prefs.includes(r.id) ||
        assignment[r.id] === h.id
      )
        continue;
      const wants =
        assignment[r.id] === null ||
        r.prefs.indexOf(h.id) < r.prefs.indexOf(assignment[r.id]);
      const held = members(assignment, h.id),
        worse = held.filter(
          (id) => h.prefs.indexOf(id) > h.prefs.indexOf(r.id),
        );
      if (wants && (held.length < h.capacity || worse.length))
        blocking.push({
          resident: r.id,
          program: h.id,
          reason:
            held.length < h.capacity
              ? "vacant seat"
              : "preferred to an incumbent",
          displaces: worse,
        });
    }
  return { stable: blocking.length === 0, issues, blocking };
}
export function deferred(raw, side = "residents") {
  const model = validate(raw);
  if (!["residents", "programs"].includes(side))
    throw Error("Unknown proposing side.");
  const assignment = blank(model),
    next = Object.fromEntries(
      (side === "residents" ? model.residents : model.hospitals).map((x) => [
        x.id,
        0,
      ]),
    );
  const steps = [
    {
      assignment: { ...assignment },
      message: "No offers yet.",
      proposal: null,
    },
  ];
  while (true) {
    let message, proposal;
    if (side === "residents") {
      const r = model.residents.find(
        (r) => assignment[r.id] === null && next[r.id] < r.prefs.length,
      );
      if (!r) break;
      const target = r.prefs[next[r.id]++];
      const h = model.hospitals.find((h) => h.id === target);
      proposal = { resident: r.id, program: h.id };
      if (!h.prefs.includes(r.id))
        message = `${r.id} proposes to ${h.id}; the program does not list this resident.`;
      else {
        const ranked = [...members(assignment, h.id), r.id].sort(
          (a, b) => h.prefs.indexOf(a) - h.prefs.indexOf(b),
        );
        assignment[r.id] = h.id;
        const rejected = ranked.length > h.capacity ? ranked.pop() : null;
        if (rejected) assignment[rejected] = null;
        message = rejected
          ? `${r.id} proposes to ${h.id}; ${rejected} is rejected.`
          : `${r.id} proposes to ${h.id}; the offer is held.`;
      }
    } else {
      const h = model.hospitals.find(
        (h) =>
          members(assignment, h.id).length < h.capacity &&
          next[h.id] < h.prefs.length,
      );
      if (!h) break;
      const target = h.prefs[next[h.id]++];
      const r = model.residents.find((r) => r.id === target);
      proposal = { resident: r.id, program: h.id };
      const previous = assignment[r.id];
      if (
        r.prefs.includes(h.id) &&
        (previous === null || r.prefs.indexOf(h.id) < r.prefs.indexOf(previous))
      ) {
        assignment[r.id] = h.id;
        message = `${h.id} offers to ${r.id}; accepted${previous ? `, releasing ${previous}` : ""}.`;
      } else message = `${h.id} offers to ${r.id}; the resident declines.`;
    }
    steps.push({ assignment: { ...assignment }, message, proposal });
  }
  return {
    side,
    assignment: { ...assignment },
    steps,
    audit: audit(model, assignment),
  };
}
export function enumerate(raw) {
  const model = validate(raw),
    assignment = blank(model),
    stable = [],
    possible = Object.fromEntries(
      model.residents.map((r) => [r.id, new Set()]),
    );
  let feasible = 0;
  function visit(i) {
    if (i === model.residents.length) {
      feasible++;
      if (audit(model, assignment).stable) {
        stable.push({ ...assignment });
        for (const r of model.residents) possible[r.id].add(assignment[r.id]);
      }
      return;
    }
    const r = model.residents[i],
      choices = [
        null,
        ...model.hospitals
          .filter(
            (h) =>
              r.prefs.includes(h.id) &&
              h.prefs.includes(r.id) &&
              members(assignment, h.id).length < h.capacity,
          )
          .map((h) => h.id),
      ];
    for (const h of choices) {
      assignment[r.id] = h;
      visit(i + 1);
    }
    assignment[r.id] = null;
  }
  visit(0);
  return {
    feasible,
    stable,
    possible: Object.fromEntries(
      Object.entries(possible).map(([r, s]) => [r, [...s]]),
    ),
  };
}
export function analyze(raw) {
  const model = validate(raw);
  return {
    format: "match-folio-analysis-v1",
    model,
    residents: deferred(model, "residents"),
    programs: deferred(model, "programs"),
    alternatives: enumerate(model),
  };
}
export const example = {
  residents: [
    { id: "Ada", prefs: ["Cedar", "Dune"] },
    { id: "Ben", prefs: ["Dune", "Cedar"] },
    { id: "Cy", prefs: ["Elm", "Fjord"] },
    { id: "Dee", prefs: ["Fjord", "Elm"] },
    { id: "Eli", prefs: ["Cedar"] },
    { id: "Flo", prefs: ["Cedar"] },
  ],
  hospitals: [
    { id: "Cedar", capacity: 2, prefs: ["Eli", "Ben", "Ada", "Flo"] },
    { id: "Dune", capacity: 1, prefs: ["Ada", "Ben"] },
    { id: "Elm", capacity: 1, prefs: ["Dee", "Cy"] },
    { id: "Fjord", capacity: 1, prefs: ["Cy", "Dee"] },
  ],
};

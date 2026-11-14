import { example, audit } from "./core.js";
const $ = (id) => document.getElementById(id);
let result = null,
  custom = null,
  busy = false,
  timer = null,
  drawnSignature = null,
  priorAssignment = {};
function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").className = error ? "error" : "";
  $("preferences-notice").textContent = text;
  $("preferences-notice").className = error ? "error" : "";
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  $("play").textContent = "Replay offers →";
}
function selected() {
  const key = $("outcome").value;
  return key.startsWith("stable-")
    ? {
        assignment: result.alternatives.stable[Number(key.slice(7))],
        steps: [],
      }
    : result[key];
}
function assignment() {
  if (custom) return custom;
  const run = selected();
  return run.steps.length
    ? run.steps[Number($("step").value)].assignment
    : run.assignment;
}
function svg(tag, attrs, text) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
function render() {
  if (!result) return;
  const m = result.model,
    a = assignment(),
    check = audit(m, a),
    run = selected();
  const canvas = $("matching");
  const signature = JSON.stringify([m, a]);
  if (signature !== drawnSignature) {
    canvas.replaceChildren();
    const ry = new Map(
      m.residents.map((r, i) => [
        r.id,
        50 + (i * 400) / Math.max(1, m.residents.length - 1),
      ]),
    );
    const hy = new Map(
      m.hospitals.map((h, i) => [
        h.id,
        65 + (i * 370) / Math.max(1, m.hospitals.length - 1),
      ]),
    );
    const colors = [
      "#478e98",
      "#9275b5",
      "#bc8652",
      "#729469",
      "#b56c85",
      "#5c83b3",
    ];
    m.residents.forEach((r, i) => {
      if (a[r.id] === null) return;
      const y1 = ry.get(r.id),
        y2 = hy.get(a[r.id]);
      const path = svg("path", {
        d: `M 205 ${y1} C 420 ${y1}, 430 ${y2}, 650 ${y2}`,
        class: "connection",
        stroke: colors[i],
        pathLength: 1,
      });
      canvas.append(path);
      if (
        priorAssignment[r.id] !== a[r.id] &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        path.animate(
          [
            { strokeDasharray: "1", strokeDashoffset: 1, opacity: 0.2 },
            { strokeDasharray: "1", strokeDashoffset: 0, opacity: 0.7 },
          ],
          { duration: 450, easing: "ease-out" },
        );
    });
    m.residents.forEach((r, i) => {
      const y = ry.get(r.id);
      canvas.append(
        svg("rect", {
          class: "resident-card",
          x: 15,
          y: y - 27,
          width: 190,
          height: 56,
          rx: 9,
        }),
      );
      canvas.append(
        svg("circle", { cx: 205, cy: y, r: 5, fill: colors[i], class: "port" }),
      );
      canvas.append(
        svg(
          "text",
          {
            x: 32,
            y: y - 4,
            class: r.id.length > 12 ? "name small-name" : "name",
          },
          r.id,
        ),
      );
      canvas.append(
        svg(
          "text",
          { x: 32, y: y + 15, class: "meta" },
          a[r.id] ?? "Unmatched",
        ),
      );
    });
    for (const h of m.hospitals) {
      const y = hy.get(h.id),
        held = Object.values(a).filter((x) => x === h.id).length;
      canvas.append(
        svg("rect", {
          class: "program-card",
          x: 650,
          y: y - 34,
          width: 290,
          height: 70,
          rx: 10,
        }),
      );
      canvas.append(svg("text", { x: 668, y: y - 9, class: "name" }, h.id));
      canvas.append(
        svg(
          "text",
          { x: 668, y: y + 17, class: "meta" },
          `${held} / ${h.capacity} seats held`,
        ),
      );
      for (let seat = 0; seat < Math.max(held, h.capacity); seat++)
        canvas.append(
          svg("circle", {
            cx: 918 - seat * 17,
            cy: y + 14,
            r: 5,
            class:
              seat >= h.capacity
                ? "seat overflow"
                : seat < held
                  ? "seat held"
                  : "seat",
          }),
        );
    }
    priorAssignment = { ...a };
    drawnSignature = signature;
  }
  canvas.setAttribute(
    "aria-label",
    m.residents.map((r) => `${r.id}: ${a[r.id] ?? "unmatched"}`).join(", "),
  );
  $("audit").replaceChildren();
  $("audit").classList.toggle("stable", check.stable);
  const title = document.createElement("b");
  title.textContent = check.stable
    ? "Stable assignment"
    : check.issues.length
      ? "Invalid assignment"
      : `${check.blocking.length} blocking pairs`;
  $("audit").append(title);
  if (check.stable)
    $("audit").append(
      document.createTextNode(
        "No acceptable pair would both prefer to deviate.",
      ),
    );
  else {
    const list = document.createElement("ul");
    for (const text of [
      ...check.issues,
      ...check.blocking.map(
        (b) => `${b.resident} + ${b.program}: ${b.reason}.`,
      ),
    ]) {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    }
    $("audit").append(list);
  }
  $("position").textContent =
    `${$("step").value} / ${Math.max(0, run.steps.length - 1)}`;
  $("step").disabled = busy || !run.steps.length || !!custom;
  $("play").disabled = busy || !run.steps.length;
  $("event").textContent = custom
    ? "Manual arrangement. Restore the selected outcome to return to its replay."
    : run.steps.length
      ? run.steps[Number($("step").value)].message
      : "An exhaustively verified stable alternative.";
  $("assignments").replaceChildren();
  for (const r of m.residents) {
    const label = document.createElement("label");
    label.append(document.createTextNode(r.id));
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Assignment for ${r.id}`);
    select.add(new Option("Unmatched", ""));
    for (const h of m.hospitals) select.add(new Option(h.id, h.id));
    select.value = a[r.id] ?? "";
    select.disabled = busy;
    select.onchange = () => {
      stop();
      custom = { ...assignment(), [r.id]: select.value || null };
      render();
      for (const field of $("assignments").querySelectorAll("select"))
        if (field.getAttribute("aria-label") === `Assignment for ${r.id}`)
          field.focus({ preventScroll: true });
      notice(
        "Manual arrangement audited against the current preference lists.",
      );
    };
    label.append(select);
    const small = document.createElement("small");
    small.textContent = `Stable options: ${result.alternatives.possible[r.id].map((x) => x ?? "unmatched").join(", ")}`;
    label.append(small);
    $("assignments").append(label);
  }
}
function choose() {
  stop();
  custom = null;
  const run = selected();
  $("step").max = String(Math.max(0, run.steps.length - 1));
  $("step").value = $("step").max;
  render();
}
function compute() {
  if (busy) return;
  stop();
  let model;
  try {
    if ($("model").value.length > 50000)
      throw Error("Market JSON is limited to 50 KB.");
    model = JSON.parse($("model").value);
  } catch (e) {
    notice(e.message, true);
    return;
  }
  busy = true;
  document
    .querySelectorAll("button,select,input,textarea")
    .forEach((e) => (e.disabled = true));
  notice("Enumerating every feasible assignment in a worker…");
  const worker = new Worker("/worker.js", { type: "module" });
  const finish = () => {
    worker.terminate();
    busy = false;
    document
      .querySelectorAll("button,select,input,textarea")
      .forEach((e) => (e.disabled = false));
    $("export").disabled = !result;
    if (result) render();
  };
  worker.onmessage = ({ data }) => {
    if (data.error) {
      notice(data.error, true);
      finish();
      return;
    }
    result = data.result;
    custom = null;
    $("outcome").replaceChildren(
      new Option("Residents propose", "residents"),
      new Option("Programs propose", "programs"),
    );
    result.alternatives.stable.forEach((_, i) =>
      $("outcome").add(
        new Option(`Stable alternative ${i + 1}`, `stable-${i}`),
      ),
    );
    $("stable-count").textContent = result.alternatives.stable.length;
    $("enumeration").textContent =
      `All ${result.alternatives.feasible.toLocaleString()} feasible assignments checked. Both proposing sides end in this stable set.`;
    choose();
    notice(
      "Complete audit. Inspect the proposing sides or challenge an assignment.",
    );
    finish();
  };
  worker.onerror = () => {
    notice("Worker failed. Reload to try again.", true);
    finish();
  };
  worker.postMessage(model);
}
$("preferences-open").onclick = () => {
  stop();
  $("preferences-dialog").showModal();
};
$("preferences-close").onclick = () => $("preferences-dialog").close();
$("outcome").onchange = choose;
$("restore").onclick = choose;
$("step").oninput = () => {
  stop();
  custom = null;
  render();
};
$("play").onclick = () => {
  if (timer) {
    stop();
    return;
  }
  custom = null;
  $("step").value = "0";
  render();
  $("play").textContent = "Pause replay";
  timer = setInterval(() => {
    const next = Number($("step").value) + 1;
    $("step").value = String(next);
    render();
    if (next >= Number($("step").max)) stop();
  }, 700);
};
$("form").onsubmit = (e) => {
  e.preventDefault();
  compute();
};
$("reset").onclick = () => {
  $("model").value = JSON.stringify(example, null, 2);
  compute();
};
$("export").onclick = () => {
  if (!result) return;
  const a = assignment(),
    data = {
      ...result,
      inspection: {
        outcome: $("outcome").value,
        step: Number($("step").value),
        manual: !!custom,
        assignment: a,
        audit: audit(result.model, a),
      },
    };
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = "match-folio-evidence.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("model").addEventListener("input", () => {
  notice(
    "Draft preferences changed. Analyze to update; exports describe the last successful market.",
  );
});
$("model").value = JSON.stringify(example, null, 2);
compute();

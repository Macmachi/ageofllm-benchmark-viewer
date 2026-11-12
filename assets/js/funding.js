/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
fetch("../data/ladder.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then((d) => {
  if (!d) return;
  const el = document.getElementById("fund-ver");
  const bits = [];
  if (d.site_version) bits.push("site v" + d.site_version);
  if (d.engine_version) bits.push("game engine v" + d.engine_version);
  if (el && bits.length) el.textContent = bits.join(" · ");
}).catch(() => {
});

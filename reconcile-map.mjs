// Derive each requirement's assessment types FROM the standard (raw extraction)
// and diff against the current ASSESSMENTS_MAP, so the map can be aligned to the
// standard. A case "counts" only if it has a real Assessment units block (not a
// "covered by sufficiency" / "Not applicable" / "None" note, which land in _note).
import fs from "fs";
const o = JSON.parse(fs.readFileSync("assessment-units-raw.json", "utf8"));

// current map — parse directly from assessments-map.ts
const mapSrc = fs.readFileSync("src/lib/decision-trees/assessments-map.ts", "utf8");
const CUR = {};
for (const m of mapSrc.matchAll(/"([^"]+)":\s*\[([^\]]*)\]/g)) {
  const types = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  CUR[m[1]] = types;
}

function derive(req) {
  const c = o[req]?.cases || {};
  const hasComp = !!c.completeness?.units;
  const hasSuff = !!c.sufficiency?.units;
  const hasConc = !!c.conceptual?.units;
  const t = [];
  if (hasComp) t.push("completeness");
  if (hasSuff) t.push("sufficiency");
  if (!hasComp && !hasSuff && hasConc) t.push("conceptual_completeness");
  return t;
}

const changes = [];
for (const req of Object.keys(CUR)) {
  const cur = CUR[req];
  const der = derive(req);
  const a = JSON.stringify(cur),
    b = JSON.stringify(der);
  if (a !== b) changes.push({ req, from: cur, to: der, raw: !o[req] ? "NO-RAW" : "" });
}
console.log(`changes: ${changes.length}`);
for (const c of changes)
  console.log(`  ${c.req}: [${c.from}] -> [${c.to}] ${c.raw}`);

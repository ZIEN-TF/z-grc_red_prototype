// Generate src/lib/decision-trees/assessment-units.ts from the parsed raw JSON,
// keyed to the canonical ASSESSMENTS_MAP (parsed live from assessments-map.ts).
// EN-only (standard text preserved verbatim; no translation). Reports any
// declared (requirement, type) pair with no extracted units.
import fs from "fs";

const o = JSON.parse(fs.readFileSync("assessment-units-raw.json", "utf8"));

// Parse ASSESSMENTS_MAP directly from the source of truth.
const mapSrc = fs.readFileSync(
  "src/lib/decision-trees/assessments-map.ts",
  "utf8",
);
const ASSESSMENTS_MAP = {};
for (const m of mapSrc.matchAll(/"((?:P[123])\.[^"]+)":\s*\[([^\]]*)\]/g)) {
  ASSESSMENTS_MAP[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const TYPE_TO_CASE = {
  completeness: "completeness",
  sufficiency: "sufficiency",
  conceptual_completeness: "conceptual",
};

const gaps = [];
const entries = {};

for (const [reqId, types] of Object.entries(ASSESSMENTS_MAP)) {
  if (types.length === 0) continue;
  const raw = o[reqId];
  const stdNum = reqId.match(/^P(\d)\./)[1];
  const specByType = {};
  for (const type of types) {
    const caseKey = TYPE_TO_CASE[type];
    const c = raw?.cases?.[caseKey];
    const units = c?.units?.trim() || c?._note?.trim();
    if (!units) {
      gaps.push(`${reqId} / ${type} (case=${caseKey}) — no units`);
      continue;
    }
    specByType[type] = {
      clause: `EN 18031-${stdNum} §${raw.clause}`,
      purpose_en: (c.purpose || "").trim(),
      units_en: units,
      verdict_en: (c.verdict || "").trim(),
    };
  }
  if (Object.keys(specByType).length) entries[reqId] = specByType;
}

const body = Object.entries(entries)
  .map(([reqId, byType]) => {
    const inner = Object.entries(byType)
      .map(
        ([type, s]) =>
          `    ${type}: {\n` +
          `      clause: ${JSON.stringify(s.clause)},\n` +
          `      purpose_en: ${JSON.stringify(s.purpose_en)},\n` +
          `      units_en: ${JSON.stringify(s.units_en)},\n` +
          `      verdict_en: ${JSON.stringify(s.verdict_en)},\n` +
          `    },`,
      )
      .join("\n");
    return `  ${JSON.stringify(reqId)}: {\n${inner}\n  },`;
  })
  .join("\n");

const ts = `// EN 18031 — Assessment Units (기능평가 판정 기준)
//
// AUTO-GENERATED from BS EN 18031-1/2/3:2024 by generate-assessment-units.mjs.
// English standard text is preserved verbatim (no translation). The AI reads
// these to draft device-specific testMethod and to assign PASS/FAIL/NA; only
// the relevant requirement's spec is injected into the prompt (never the whole
// standard), keeping token usage minimal.
//
// To regenerate: node generate-assessment-units.mjs
// Do not hand-edit; edit the parser/generator instead.

import type { AssessmentType } from "./types";

export type AssessmentUnitSpec = {
  clause: string; // standard reference, e.g. "EN 18031-1 §6.1.1"
  purpose_en: string; // Assessment purpose
  units_en: string; // Assessment units (verbatim; includes all implementation categories)
  verdict_en: string; // Assignment of verdict (PASS/FAIL/NA criteria)
};

export const ASSESSMENT_UNITS: Record<
  string,
  Partial<Record<AssessmentType, AssessmentUnitSpec>>
> = {
${body}
};

export function assessmentUnitFor(
  requirementId: string,
  type: AssessmentType,
): AssessmentUnitSpec | undefined {
  return ASSESSMENT_UNITS[requirementId]?.[type];
}
`;

fs.writeFileSync("src/lib/decision-trees/assessment-units.ts", ts, "utf8");

const declared = Object.values(ASSESSMENTS_MAP).reduce((a, t) => a + t.length, 0);
const produced = Object.values(entries).reduce(
  (a, b) => a + Object.keys(b).length,
  0,
);
console.log(`map keys: ${Object.keys(ASSESSMENTS_MAP).length}`);
console.log(`requirements with specs: ${Object.keys(entries).length}`);
console.log(`declared assessment cases: ${declared}, produced: ${produced}`);
console.log(`GAPS (${gaps.length}):`);
for (const g of gaps) console.log("  - " + g);

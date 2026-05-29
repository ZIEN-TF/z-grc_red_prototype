// Builds grounding context for the AI assessment pipeline from the repo's
// authoritative EN 18031 data (requirements, decision trees, assessment units,
// definitions). The AI is instructed to rely ONLY on this provided text — never
// prior knowledge — so output stays faithful to the standard. Only the relevant
// requirement's slice is assembled per call; static blocks (definitions) are
// stable across a run so they can be prompt-cached by the caller.

import {
  requirementById,
  assessmentUnitFor,
  type AssessmentType,
  type DTRequirement,
  type DTBranch,
} from "../decision-trees";
import { definitionsText } from "../decision-trees/definitions";
import { mechanismByCode, type StandardId } from "../mechanisms";

// Strict grounding instruction shared by every assessment prompt.
export const GROUNDING_INSTRUCTION = `You are assisting an EN 18031 (RED Art. 3.3) cybersecurity conformity assessment.
Base every judgement STRICTLY on (a) the EN 18031 excerpts provided in this prompt and (b) the firmware/document analysis findings provided.
Do NOT rely on prior knowledge of the standard or invent requirements. Use the exact terms as defined in the provided definitions.
Apply the provided "Assignment of verdict" criteria mechanically to decide PASS / FAIL / NOT APPLICABLE.
If the provided material does not contain enough evidence to judge — or the check requires running the physical device (dynamic testing) — do NOT guess: state that it requires manual testing.`;

export function standardOf(requirementId: string): StandardId {
  const n = Number(requirementId.match(/^P(\d)\./)?.[1]);
  return (n === 2 ? 2 : n === 3 ? 3 : 1) as StandardId;
}

function describeBranch(branch: DTBranch): string {
  if ("outcome" in branch) {
    return branch.outcome === "pass"
      ? "PASS"
      : branch.outcome === "fail"
        ? "FAIL"
        : "NOT APPLICABLE";
  }
  return `go to ${branch.goto}`;
}

// Render a requirement's decision tree as readable text the AI can "walk".
export function renderDecisionTree(req: DTRequirement): string {
  const lines: string[] = [`Root node: ${req.rootNodeId}`];
  for (const [id, node] of Object.entries(req.nodes)) {
    lines.push(
      `${id}: ${node.text_en}`,
      `  - YES → ${describeBranch(node.yes)}`,
      `  - NO → ${describeBranch(node.no)}`,
    );
  }
  return lines.join("\n");
}

// Definitions block for a standard (cacheable; identical across a run).
export function definitionsBlock(std: StandardId): string {
  return `## EN 18031-${std} Terms and definitions (use these exact meanings)\n${definitionsText(std)}`;
}

// Assessment-unit block for the requirement + the assessment types requested.
function assessmentBlock(
  requirementId: string,
  types: AssessmentType[],
): string {
  const parts: string[] = [];
  for (const t of types) {
    const u = assessmentUnitFor(requirementId, t);
    if (!u) continue;
    parts.push(
      `### ${t} assessment (${u.clause})\n` +
        `Purpose: ${u.purpose_en}\n` +
        `Assessment units:\n${u.units_en}\n` +
        `Assignment of verdict:\n${u.verdict_en}`,
    );
  }
  return parts.join("\n\n");
}

// Full grounding for assessing one requirement. `definitions` is omitted here
// because the caller injects definitionsBlock() once (cached) per run.
export function requirementGrounding(
  requirementId: string,
  types: AssessmentType[],
): string | null {
  const req = requirementById(requirementId);
  if (!req) return null;
  const mech = mechanismByCode(req.mechanismCode);
  const sections: string[] = [
    `## Requirement ${req.id} — ${req.title_en} (${req.clause})`,
    `Requirement: ${req.requirementText_en}`,
  ];
  if (mech) {
    sections.push(
      `Mechanism ${mech.code} — ${mech.name_en}: ${mech.description_en}`,
    );
  }
  if (req.iterateOver) {
    sections.push(`Iterated per asset: ${req.iterateOver.description_en}`);
  }
  sections.push(`## Decision tree\n${renderDecisionTree(req)}`);
  const ab = assessmentBlock(requirementId, types);
  if (ab) sections.push(`## Assessment criteria\n${ab}`);
  return sections.join("\n\n");
}

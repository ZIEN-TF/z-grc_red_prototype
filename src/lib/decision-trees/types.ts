// EN 18031 Decision Trees — type definitions + walker.

import type { AssetKind } from "../asset-kinds";
import type { StandardId } from "../mechanisms";

export type DTOutcome = "pass" | "fail" | "not_applicable";

// A user's (or AI's) answer to a single DT node. "na" is a node-level
// short-circuit: answering any node "na" terminates that iteration with a
// NOT APPLICABLE outcome, independent of the node's yes/no branches.
export type NodeAnswer = "yes" | "no" | "na";

// Technical assessment types performed by a certification consultant after
// the Required Information has been captured. Each requirement declares which
// of these apply via the assessments-map.
export type AssessmentType =
  | "completeness" // 기능 완전성 평가 — does the mechanism implement the required functionality?
  | "sufficiency" // 기능 충분성 평가 — is the implementation sufficient against relevant threats?
  | "conceptual_completeness"; // 개념적 완전성 평가 — conceptual-level review only (e.g. CCK-2)

export const ASSESSMENT_LABEL_KO: Record<AssessmentType, string> = {
  completeness: "기능 완전성 평가",
  sufficiency: "기능 충분성 평가",
  conceptual_completeness: "개념적 완전성 평가",
};

export const ASSESSMENT_LABEL_EN: Record<AssessmentType, string> = {
  completeness: "Functional Completeness Assessment",
  sufficiency: "Functional Sufficiency Assessment",
  conceptual_completeness: "Conceptual Completeness Assessment",
};

// Optional prompt shown next to the user's evidence field when they follow this
// branch. If omitted, a default prompt derived from the branch's outcome (or
// a generic one for goto branches) is used.
type BranchEvidence = {
  evidencePrompt_ko?: string;
  evidencePrompt_en?: string;
};

export type DTBranch =
  | ({ goto: string } & BranchEvidence)
  | ({ outcome: DTOutcome } & BranchEvidence);

export function defaultEvidencePrompt(
  outcome: DTOutcome | null,
): { ko: string; en: string } {
  if (outcome === "pass")
    return {
      ko: "어떻게 요구사항을 충족하는지 구체적으로 기술하세요 (구성·설정·메커니즘).",
      en: "Describe how the requirement is met (implementation, configuration).",
    };
  if (outcome === "fail")
    return {
      ko: "요구사항을 충족하지 못한 사유, 영향 평가, 개선 계획 또는 위험 수용 근거를 기술하세요.",
      en: "Describe reason for failure, impact, remediation plan or risk acceptance.",
    };
  if (outcome === "not_applicable")
    return {
      ko: "해당되지 않는 사유·근거를 기술하세요 (관련 조항·문서 참조).",
      en: "Describe why this is not applicable (with references if any).",
    };
  return {
    ko: "이 단계의 근거·비고 (선택).",
    en: "Evidence or notes for this step (optional).",
  };
}

export function branchOutcome(branch: DTBranch): DTOutcome | null {
  return "outcome" in branch ? branch.outcome : null;
}

export function evidencePromptFor(
  node: DTNode,
  answer: NodeAnswer,
): { ko: string; en: string } {
  // Node-level N/A always maps to the not-applicable evidence prompt.
  if (answer === "na") {
    return defaultEvidencePrompt("not_applicable");
  }
  const branch = answer === "yes" ? node.yes : node.no;
  if (branch.evidencePrompt_ko || branch.evidencePrompt_en) {
    const def = defaultEvidencePrompt(branchOutcome(branch));
    return {
      ko: branch.evidencePrompt_ko ?? def.ko,
      en: branch.evidencePrompt_en ?? def.en,
    };
  }
  return defaultEvidencePrompt(branchOutcome(branch));
}

export type DTNode = {
  id: string;
  text_en: string;
  text_ko: string;
  hint_en?: string;
  hint_ko?: string;
  yes: DTBranch;
  no: DTBranch;
};

export type MetadataFilter = { field: string; values: string[] };

export type IterationScope = {
  description_en: string;
  description_ko: string;
  kinds: AssetKind[];
  // Single filter or array of filters (AND). All must match for an asset
  // to be iterated.
  metadataIn?: MetadataFilter | MetadataFilter[];
};

export type ScreeningCondition = {
  questionId: string; // e.g., "A4"
  answer: "yes" | "no"; // required answer in screening
  // Optional human-readable reason for display when the condition gates the
  // requirement to NOT APPLICABLE.
  reason_ko?: string;
  reason_en?: string;
};

// Automatic NOT APPLICABLE gating based on another requirement's DT answers
// for the SAME asset (or same global iteration if iterateOver is null).
// Used e.g. to make ACM-2 auto-NA for an asset when ACM-1's path for that
// asset resolved to NA via DN-1/2/3.
export type NAFromRequirement = {
  requirementId: string; // e.g., "P1.ACM-1"
  // If ANY of these (nodeId, answer) pairs was recorded for the same asset
  // in the linked requirement, this requirement is automatically NA.
  ifAnyAnswer: Array<{ nodeId: string; answer: "yes" | "no" }>;
  reason_ko?: string;
  reason_en?: string;
};

export type EvidenceFieldScope = "per_asset" | "per_requirement";

export type EvidenceField = {
  id: string; // e.g., "E.Info.ACM-1.SecurityAsset.Access"
  scope: EvidenceFieldScope;
  // If per_asset and set, only show for iterations of these kinds
  appliesToKinds?: AssetKind[];
  // If set, show only when the referenced DN has the specified answer in the
  // user's answered path.
  dependsOnAnswer?: { nodeId: string; answer: "yes" | "no" };
  prompt_ko: string;
  prompt_en: string;
  // Short group label shown above the field (e.g., "Security Asset"). Optional.
  group_ko?: string;
  group_en?: string;
  required?: boolean;
  multiline?: boolean; // rendering hint
  // If true, shows the auto-generated DT path summary immediately above this
  // field's input (useful for Justification fields that reference the path).
  showPathAbove?: boolean;
};

export type DTRequirement = {
  id: string; // e.g., "P1.ACM-1", "P2.ACM-3"
  mechanismCode: string; // "ACM"
  standards: StandardId[]; // [1], [2], or [3]
  clause: string;
  title_en: string;
  title_ko: string;
  requirementText_en: string;
  requirementText_ko: string;
  iterateOver: IterationScope | null;
  rootNodeId: string;
  nodes: Record<string, DTNode>;
  // If set, answers can be copied from this requirement (same DT node structure).
  sameAs?: string;
  // If set, the requirement is only applicable when ALL listed screening
  // conditions match. Used to short-circuit DTs whose applicability is already
  // determined by the screening phase (e.g., toy-only requirements when the
  // equipment is not a toy).
  appliesOnlyIf?: ScreeningCondition[];
  // If set, the requirement is automatically NOT APPLICABLE for an asset
  // iteration when the linked requirement's answers for the SAME asset
  // include any of the specified (nodeId, answer) pairs. Example: ACM-2
  // auto-NA when ACM-1 DN-1/2/3 YES for the same asset.
  naFromRequirement?: NAFromRequirement;
  // Required-information fields per EN 18031 standard.
  // If omitted, fall back to legacy `DTAnswer.notes` collection.
  evidenceFields?: EvidenceField[];
};

// Common terminal-branch helpers (used when authoring DTs)
export const PASS: DTBranch = { outcome: "pass" };
export const FAIL: DTBranch = { outcome: "fail" };
export const NA: DTBranch = { outcome: "not_applicable" };
export const GOTO = (id: string): DTBranch => ({ goto: id });

// Asset matching / filtering
export function matchAssetsForRequirement<
  A extends { kind: string; metadata: Record<string, string> },
>(
  req: DTRequirement,
  assets: A[],
  // Optional: override which asset kinds to include. Used with
  // `getApplicableKindsFor` to dedupe overlap with earlier applicable standards.
  kindsOverride?: AssetKind[],
): A[] {
  if (!req.iterateOver) return [];
  const scope = req.iterateOver;
  const kinds = kindsOverride ?? scope.kinds;
  const filters: MetadataFilter[] = scope.metadataIn
    ? Array.isArray(scope.metadataIn)
      ? scope.metadataIn
      : [scope.metadataIn]
    : [];
  return assets.filter((a) => {
    if (!kinds.includes(a.kind as AssetKind)) return false;
    for (const f of filters) {
      const v = a.metadata[f.field];
      if (!v || !f.values.includes(v)) return false;
    }
    return true;
  });
}

// For a requirement that participates in a `sameAs` family (i.e., structurally
// equivalent requirements exist across EN 18031-1/2/3), remove asset kinds
// already covered by an earlier applicable standard's equivalent requirement.
// Example: if P1 and P2 both apply and P2.ACM-1 sameAs P1.ACM-1, P2.ACM-1's
// kinds become [privacy_asset] because security_asset is already answered
// under P1.ACM-1.
//
// Requirements with no `sameAs` (family root or unique requirement) return
// all of their original kinds.
export function getApplicableKindsFor(
  req: DTRequirement,
  allRequirements: DTRequirement[],
  applicableStandards: StandardId[],
): AssetKind[] {
  if (!req.iterateOver) return [];
  const ownKinds = req.iterateOver.kinds;
  if (!req.sameAs) return [...ownKinds];

  const rootId = req.sameAs;
  const myMinStandard = Math.min(...req.standards);
  const earlierApplicable = allRequirements.filter((r) => {
    if (r.id === req.id) return false;
    const isFamily = r.id === rootId || r.sameAs === rootId;
    if (!isFamily) return false;
    const isApplicable = r.standards.some((s) =>
      applicableStandards.includes(s),
    );
    if (!isApplicable) return false;
    return Math.min(...r.standards) < myMinStandard;
  });

  const covered = new Set<string>();
  for (const r of earlierApplicable) {
    if (!r.iterateOver) continue;
    for (const k of r.iterateOver.kinds) covered.add(k);
  }
  return ownKinds.filter((k) => !covered.has(k));
}

// Check whether a requirement is applicable given the project's screening
// answers. Returns the first unmet condition if not applicable.
export function evaluateRequirementApplicability(
  req: DTRequirement,
  screeningAnswers: Record<string, "yes" | "no">,
): { applies: true } | { applies: false; failedCondition: ScreeningCondition } {
  if (!req.appliesOnlyIf || req.appliesOnlyIf.length === 0) {
    return { applies: true };
  }
  for (const cond of req.appliesOnlyIf) {
    if (screeningAnswers[cond.questionId] !== cond.answer) {
      return { applies: false, failedCondition: cond };
    }
  }
  return { applies: true };
}

// Evaluate `naFromRequirement` against the linked requirement's answers
// for the same asset. Returns the matched gate when auto-NA applies.
export function evaluateNAFromRequirement(
  req: DTRequirement,
  linkedAnswers: Array<{ nodeId: string; answer: "yes" | "no" }>,
):
  | { applies: false }
  | {
      applies: true;
      gate: NAFromRequirement;
      matched: { nodeId: string; answer: "yes" | "no" };
    } {
  const gate = req.naFromRequirement;
  if (!gate) return { applies: false };
  for (const pair of gate.ifAnyAnswer) {
    const hit = linkedAnswers.find(
      (a) => a.nodeId === pair.nodeId && a.answer === pair.answer,
    );
    if (hit) {
      return { applies: true, gate, matched: hit };
    }
  }
  return { applies: false };
}

export type PathStep = { nodeId: string; answer: NodeAnswer };

export type WalkState =
  | { kind: "question"; nodeId: string; path: PathStep[] }
  | { kind: "outcome"; outcome: DTOutcome; path: PathStep[] };

// Render a human-readable summary like "DN-1 No → DN-2 No → DN-3 No → DN-4 Yes → PASS".
export function buildPathSummary(walk: WalkState): string {
  const parts = walk.path.map(
    (s) =>
      `${s.nodeId} ${s.answer === "yes" ? "Yes" : s.answer === "no" ? "No" : "N/A"}`,
  );
  if (walk.kind === "outcome") {
    const label =
      walk.outcome === "pass"
        ? "PASS"
        : walk.outcome === "fail"
          ? "FAIL"
          : "NOT APPLICABLE";
    parts.push(label);
  }
  return parts.join(" → ");
}

export function walkTree(
  req: DTRequirement,
  answers: Record<string, NodeAnswer>,
): WalkState {
  const path: PathStep[] = [];
  const visited = new Set<string>();
  let currentId = req.rootNodeId;

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const node = req.nodes[currentId];
    if (!node) {
      throw new Error(`Missing DT node: ${req.id} / ${currentId}`);
    }
    const answer = answers[currentId];
    if (!answer) {
      return { kind: "question", nodeId: currentId, path };
    }
    path.push({ nodeId: currentId, answer });
    // Node-level N/A short-circuits the entire iteration to NOT APPLICABLE,
    // regardless of the node's yes/no branches.
    if (answer === "na") {
      return { kind: "outcome", outcome: "not_applicable", path };
    }
    const branch = answer === "yes" ? node.yes : node.no;
    if ("outcome" in branch) {
      return { kind: "outcome", outcome: branch.outcome, path };
    }
    currentId = branch.goto;
  }
  throw new Error(`DT cycle detected: ${req.id} at ${currentId}`);
}

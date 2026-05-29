import { P1_REQUIREMENTS } from "./part1";
import { P2_REQUIREMENTS } from "./part2";
import { P3_REQUIREMENTS } from "./part3";
import type { DTRequirement } from "./types";

export * from "./types";
export { assessmentsFor, ASSESSMENTS_MAP } from "./assessments-map";
export { evidenceExampleFor } from "./evidence-examples";
export {
  assessmentUnitFor,
  ASSESSMENT_UNITS,
  type AssessmentUnitSpec,
} from "./assessment-units";
export { definitionsText, DEFINITIONS } from "./definitions";

export const DT_REQUIREMENTS: DTRequirement[] = [
  ...P1_REQUIREMENTS,
  ...P2_REQUIREMENTS,
  ...P3_REQUIREMENTS,
];

export function requirementById(id: string): DTRequirement | undefined {
  return DT_REQUIREMENTS.find((r) => r.id === id);
}

export function requirementsForMechanism(code: string): DTRequirement[] {
  return DT_REQUIREMENTS.filter((r) => r.mechanismCode === code);
}

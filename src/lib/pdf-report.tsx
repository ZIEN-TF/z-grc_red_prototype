/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only PDF rendering for the final report using @react-pdf/renderer.

import path from "path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToStream,
} from "@react-pdf/renderer";
import {
  DT_REQUIREMENTS,
  requirementById,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  getApplicableKindsFor,
  matchAssetsForRequirement,
  walkTree,
  buildPathSummary,
  assessmentsFor,
  ASSESSMENT_LABEL_KO,
  type DTOutcome,
  type DTRequirement,
  type EvidenceField,
  type AssessmentType,
  type NodeAnswer,
} from "@/lib/decision-trees";
import { kindConfig } from "@/lib/asset-kinds";
import { STANDARDS, type StandardId } from "@/lib/mechanisms";

// ── Font registration ───────────────────────────────────────────────
// NanumGothic ships as a single TTF file with full Korean glyph coverage,
// which avoids the glyph-subset problems seen with @fontsource web subsets.
let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  const base = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: path.join(base, "NanumGothic-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(base, "NanumGothic-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Disable hyphenation for Korean (no word-break hyphens)
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

// ── Data building (mirrors the report page logic) ───────────────────

type IterationStatus = DTOutcome | "incomplete" | "auto_na";
type VerdictValue = "pass" | "fail" | "not_applicable" | null;

type IterationBlock = {
  assetLabel: string | null;
  status: IterationStatus;
  pathSummary: string;
  evidenceFields: Array<{ field: EvidenceField; value: string }>;
  assessments: Array<{
    type: AssessmentType;
    testMethod: string;
    testResult: string;
    verdict: VerdictValue;
    attachmentFilename: string | null;
  }>;
};

type RequirementBlock = {
  req: DTRequirement;
  iterations: IterationBlock[];
};

type StandardSection = {
  standard: StandardId;
  blocks: RequirementBlock[];
  stats: { total: number; pass: number; fail: number; na: number; pending: number };
};

export type ReportData = {
  project: {
    id: string;
    name: string;
    manufacturer: string;
    contactName: string | null;
    contactEmail: string | null;
    productType: string | null;
    productDescription: string | null;
    finalizedAt: Date | null;
    finalizedBy: string | null;
    finalizedNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  applicableStandards: StandardId[];
  sections: Record<number, StandardSection>;
  attachmentCount: number;
  generatedAt: Date;
  hideAssessments: boolean;
};

export function buildReportData(
  project: any,
  opts: { hideAssessments?: boolean } = {},
): ReportData {
  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  const candidates: string[] = JSON.parse(project.mechanismCandidates);
  const screeningMap: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no")
      screeningMap[a.questionId] = a.answer;
  }
  const parsedAssets = project.assets.map((a: any) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    metadata: safeJson(a.metadata),
  }));

  const evidenceMap = new Map<string, string>();
  for (const ev of project.dtEvidences) {
    const key = `${ev.requirementId}::${ev.assetId ?? "__global__"}::${ev.fieldId}`;
    evidenceMap.set(key, ev.value);
  }
  const assessmentMap = new Map<
    string,
    {
      testMethod: string;
      testResult: string;
      verdict: VerdictValue;
      attachmentFilename: string | null;
    }
  >();
  for (const a of project.dtAssessments) {
    const key = `${a.requirementId}::${a.assetId ?? "__global__"}::${a.assessmentType}`;
    assessmentMap.set(key, {
      testMethod: a.testMethod,
      testResult: a.testResult,
      verdict:
        a.verdict === "pass" || a.verdict === "fail" || a.verdict === "not_applicable"
          ? a.verdict
          : null,
      attachmentFilename: a.attachmentFilename,
    });
  }

  const sections: Record<number, StandardSection> = {};
  for (const std of applicableStandards) {
    sections[std] = buildSection({
      standard: std,
      candidates,
      screeningMap,
      applicableStandards,
      parsedAssets,
      dtAnswers: project.dtAnswers,
      evidenceMap,
      assessmentMap,
    });
  }

  return {
    project,
    applicableStandards,
    sections,
    attachmentCount: project.attachments.length,
    generatedAt: new Date(),
    hideAssessments: !!opts.hideAssessments,
  };
}

function buildSection(args: {
  standard: StandardId;
  candidates: string[];
  screeningMap: Record<string, "yes" | "no">;
  applicableStandards: StandardId[];
  parsedAssets: any[];
  dtAnswers: any[];
  evidenceMap: Map<string, string>;
  assessmentMap: Map<string, any>;
}): StandardSection {
  const {
    standard,
    candidates,
    screeningMap,
    applicableStandards,
    parsedAssets,
    dtAnswers,
    evidenceMap,
    assessmentMap,
  } = args;

  const visible = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.includes(standard) &&
      evaluateRequirementApplicability(r, screeningMap).applies,
  );

  const blocks: RequirementBlock[] = [];
  const stats = { total: 0, pass: 0, fail: 0, na: 0, pending: 0 };

  for (const req of visible) {
    const assessTypes = assessmentsFor(req.id);
    const iterations: IterationBlock[] = [];

    if (req.iterateOver) {
      const dedupedKinds = getApplicableKindsFor(req, DT_REQUIREMENTS, applicableStandards);
      const matching = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
      for (const a of matching) {
        // Auto-NA via naFromRequirement
        if (req.naFromRequirement) {
          const linked = dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                d.assetId === a.id,
            )
            .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
          const res = evaluateNAFromRequirement(
            req,
            linked,
            requirementById(req.naFromRequirement!.requirementId),
          );
          if (res.applies) {
            iterations.push({
              assetLabel: `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
              status: "auto_na",
              pathSummary: "",
              evidenceFields: [],
              assessments: [],
            });
            continue;
          }
        }
        const answers: Record<string, NodeAnswer> = {};
        for (const d of dtAnswers) {
          if (d.requirementId === req.id && d.assetId === a.id) {
            if (d.answer === "yes" || d.answer === "no" || d.answer === "na")
              answers[d.nodeId] = d.answer;
          }
        }
        if (Object.keys(answers).length === 0) {
          iterations.push({
            assetLabel: `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
            status: "incomplete",
            pathSummary: "",
            evidenceFields: [],
            assessments: [],
          });
          continue;
        }
        iterations.push(
          buildIter(
            req,
            a.id,
            `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
            a.kind,
            answers,
            evidenceMap,
            assessmentMap,
            assessTypes,
          ),
        );
      }
    } else {
      if (req.naFromRequirement) {
        const linked = dtAnswers
          .filter(
            (d) =>
              d.requirementId === req.naFromRequirement!.requirementId &&
              d.assetId === null,
          )
          .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
        if (
          evaluateNAFromRequirement(
            req,
            linked,
            requirementById(req.naFromRequirement!.requirementId),
          ).applies
        ) {
          iterations.push({
            assetLabel: null,
            status: "auto_na",
            pathSummary: "",
            evidenceFields: [],
            assessments: [],
          });
        }
      }
      if (iterations.length === 0) {
        const answers: Record<string, NodeAnswer> = {};
        for (const d of dtAnswers) {
          if (d.requirementId === req.id && d.assetId === null) {
            if (d.answer === "yes" || d.answer === "no" || d.answer === "na")
              answers[d.nodeId] = d.answer;
          }
        }
        if (Object.keys(answers).length > 0) {
          iterations.push(
            buildIter(req, null, null, null, answers, evidenceMap, assessmentMap, assessTypes),
          );
        } else {
          iterations.push({
            assetLabel: null,
            status: "incomplete",
            pathSummary: "",
            evidenceFields: [],
            assessments: [],
          });
        }
      }
    }

    for (const it of iterations) {
      stats.total++;
      if (it.status === "pass") stats.pass++;
      else if (it.status === "fail") stats.fail++;
      else if (it.status === "not_applicable" || it.status === "auto_na") stats.na++;
      else stats.pending++;
    }

    if (iterations.length > 0) {
      blocks.push({ req, iterations });
    }
  }

  return { standard, blocks, stats };
}

function buildIter(
  req: DTRequirement,
  _assetId: string | null,
  assetLabel: string | null,
  assetKind: string | null,
  answers: Record<string, NodeAnswer>,
  evidenceMap: Map<string, string>,
  assessmentMap: Map<string, any>,
  assessTypes: AssessmentType[],
): IterationBlock {
  const walk = walkTree(req, answers);
  const status: IterationStatus =
    walk.kind === "question" ? "incomplete" : (walk.outcome as IterationStatus);
  const pathSummary = buildPathSummary(walk);

  const evidenceFields: Array<{ field: EvidenceField; value: string }> = [];
  if (req.evidenceFields) {
    for (const f of req.evidenceFields) {
      if (
        f.scope === "per_asset" &&
        f.appliesToKinds &&
        (assetKind === null || !f.appliesToKinds.includes(assetKind as never))
      ) {
        continue;
      }
      if (f.dependsOnAnswer) {
        if (answers[f.dependsOnAnswer.nodeId] !== f.dependsOnAnswer.answer) continue;
      }
      const key = `${req.id}::${_assetId ?? "__global__"}::${f.id}`;
      evidenceFields.push({ field: f, value: evidenceMap.get(key) ?? "" });
    }
  }

  const assessments: IterationBlock["assessments"] = [];
  if (status === "pass" || status === "fail") {
    for (const t of assessTypes) {
      const key = `${req.id}::${_assetId ?? "__global__"}::${t}`;
      const rec = assessmentMap.get(key);
      assessments.push({
        type: t,
        testMethod: rec?.testMethod ?? "",
        testResult: rec?.testResult ?? "",
        verdict: rec?.verdict ?? null,
        attachmentFilename: rec?.attachmentFilename ?? null,
      });
    }
  }

  return { assetLabel, status, pathSummary, evidenceFields, assessments };
}

function safeJson(s: string): Record<string, string> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}

// ── PDF styles ─────────────────────────────────────────────────────
const colors = {
  primary: "#2563eb",
  primaryBg: "#eff6ff",
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  bg: "#f9fafb",
  pass: "#059669",
  fail: "#dc2626",
  na: "#9ca3af",
  pending: "#f59e0b",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontFamily: "NotoSansKR",
    fontSize: 9,
    color: colors.text,
    lineHeight: 1.4,
  },
  h1: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  h2: { fontSize: 13, fontWeight: "bold", marginTop: 12, marginBottom: 6, color: colors.primary },
  h3: { fontSize: 10, fontWeight: "bold", marginBottom: 3 },
  muted: { color: colors.muted, fontSize: 8 },
  row: { flexDirection: "row" },
  col: { flexDirection: "column" },
  border: { borderWidth: 0.5, borderColor: colors.border, borderRadius: 3 },
  box: {
    padding: 8,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 3,
    marginBottom: 6,
    backgroundColor: colors.bg,
  },
  kv: { flexDirection: "row", marginBottom: 2 },
  kvLabel: { color: colors.muted, fontSize: 8, width: 70 },
  kvValue: { flex: 1, fontSize: 9 },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
    fontSize: 8,
    color: "#fff",
  },
  mono: { fontFamily: "NotoSansKR", fontSize: 8 },
  table: {
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 3,
    marginTop: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    minHeight: 18,
  },
  tableRowLast: { flexDirection: "row", minHeight: 18 },
  tableHeader: {
    backgroundColor: colors.primaryBg,
    fontWeight: "bold",
  },
  tableCell: { padding: 4, fontSize: 8 },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 3,
    marginHorizontal: 2,
  },
  statCount: { fontSize: 14, fontWeight: "bold" },
  statLabel: { fontSize: 7, color: colors.muted, marginTop: 2 },
  reqCard: {
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  iterBox: {
    marginTop: 6,
    padding: 6,
    backgroundColor: colors.bg,
    borderRadius: 2,
  },
  sectionHeader: {
    backgroundColor: colors.primary,
    color: "#fff",
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 3,
  },
});

function verdictColor(v: IterationStatus | VerdictValue): string {
  if (v === "pass") return colors.pass;
  if (v === "fail") return colors.fail;
  if (v === "not_applicable" || v === "auto_na") return colors.na;
  return colors.pending;
}

function outcomeLabel(s: IterationStatus): string {
  if (s === "pass") return "PASS";
  if (s === "fail") return "FAIL";
  if (s === "not_applicable") return "N/A";
  if (s === "auto_na") return "N/A (AUTO)";
  return "진행중";
}

function verdictLabel(v: VerdictValue): string {
  if (v === "pass") return "PASS";
  if (v === "fail") return "FAIL";
  if (v === "not_applicable") return "N/A";
  return "미판정";
}

// ── PDF components ─────────────────────────────────────────────────

export function ReportDocument({ data }: { data: ReportData }) {
  const { project, applicableStandards, sections, generatedAt } = data;
  return (
    <Document title={`Report - ${project.name}`} author="Z-GRC">
      {/* Cover + summary */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>EN 18031 자가 평가 리포트</Text>
        <Text style={styles.muted}>EN 18031 Self-Assessment Report</Text>
        <View style={{ marginTop: 12, ...styles.box }}>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>제품</Text>
            <Text style={styles.kvValue}>{project.name}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>제조사</Text>
            <Text style={styles.kvValue}>{project.manufacturer}</Text>
          </View>
          {project.productType && (
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>제품 유형</Text>
              <Text style={styles.kvValue}>{project.productType}</Text>
            </View>
          )}
          {project.contactName && (
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>담당자</Text>
              <Text style={styles.kvValue}>
                {project.contactName}
                {project.contactEmail ? ` <${project.contactEmail}>` : ""}
              </Text>
            </View>
          )}
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>적용 표준</Text>
            <Text style={styles.kvValue}>
              {applicableStandards.length === 0
                ? "없음"
                : applicableStandards
                    .map((s) => `EN 18031-${s} (${STANDARDS[s].name_ko})`)
                    .join(", ")}
            </Text>
          </View>
          {project.finalizedAt && (
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>확정</Text>
              <Text style={[styles.kvValue, { color: colors.pass }]}>
                {new Date(project.finalizedAt).toLocaleString("ko-KR")}
                {project.finalizedBy ? ` · ${project.finalizedBy}` : ""}
              </Text>
            </View>
          )}
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>생성일</Text>
            <Text style={styles.kvValue}>{generatedAt.toLocaleString("ko-KR")}</Text>
          </View>
        </View>

        {project.productDescription && (
          <View style={styles.box}>
            <Text style={styles.h3}>제품 설명</Text>
            <Text>{project.productDescription}</Text>
          </View>
        )}

        {/* Per-standard summary */}
        <Text style={styles.h2}>전체 요약</Text>
        {applicableStandards.map((s) => (
          <StandardSummary key={s} standard={s} section={sections[s]} />
        ))}
      </Page>

      {/* Per-standard detail pages */}
      {applicableStandards.map((s) => (
        <Page key={s} size="A4" style={styles.page}>
          <View style={styles.sectionHeader}>
            <Text style={{ fontSize: 14, fontWeight: "bold" }}>
              EN 18031-{s} — {STANDARDS[s].name_ko}
            </Text>
          </View>
          {sections[s].blocks.map((block) => (
            <RequirementBlockPdf
              key={block.req.id}
              block={block}
              hideAssessments={data.hideAssessments}
            />
          ))}
        </Page>
      ))}
    </Document>
  );
}

function StandardSummary({
  standard,
  section,
}: {
  standard: StandardId;
  section: StandardSection;
}) {
  const { stats } = section;
  const resolved = stats.pass + stats.fail + stats.na;
  const pct = stats.total === 0 ? 0 : Math.round((resolved / stats.total) * 100);

  return (
    <View style={[styles.box, { padding: 10 }]}>
      <Text style={styles.h3}>
        EN 18031-{standard} ({STANDARDS[standard].name_ko}) · 완료율 {pct}%
      </Text>
      <View style={[styles.row, { marginTop: 6 }]}>
        <View style={[styles.statBox, { backgroundColor: "#f3f4f6" }]}>
          <Text style={styles.statCount}>{stats.total}</Text>
          <Text style={styles.statLabel}>전체</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#d1fae5" }]}>
          <Text style={[styles.statCount, { color: colors.pass }]}>{stats.pass}</Text>
          <Text style={styles.statLabel}>PASS</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#fee2e2" }]}>
          <Text style={[styles.statCount, { color: colors.fail }]}>{stats.fail}</Text>
          <Text style={styles.statLabel}>FAIL</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#e5e7eb" }]}>
          <Text style={[styles.statCount, { color: colors.na }]}>{stats.na}</Text>
          <Text style={styles.statLabel}>N/A</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: "#fef3c7" }]}>
          <Text style={[styles.statCount, { color: colors.pending }]}>
            {stats.pending}
          </Text>
          <Text style={styles.statLabel}>진행중</Text>
        </View>
      </View>
    </View>
  );
}

function RequirementBlockPdf({
  block,
  hideAssessments,
}: {
  block: RequirementBlock;
  hideAssessments: boolean;
}) {
  return (
    <View style={styles.reqCard} wrap={false}>
      <View style={[styles.row, { marginBottom: 4, alignItems: "center" }]}>
        <Text
          style={{
            fontFamily: "NotoSansKR",
            fontSize: 9,
            backgroundColor: colors.primaryBg,
            color: colors.primary,
            paddingHorizontal: 4,
            paddingVertical: 1,
            marginRight: 6,
            borderRadius: 2,
          }}
        >
          {block.req.id}
        </Text>
        <Text style={{ fontSize: 10, fontWeight: "bold", flex: 1 }}>
          {block.req.title_ko}
        </Text>
      </View>
      <Text style={[styles.muted, { marginBottom: 4 }]}>
        {block.req.clause}
      </Text>
      {block.iterations.map((it, idx) => (
        <IterationPdf key={idx} iteration={it} hideAssessments={hideAssessments} />
      ))}
    </View>
  );
}

function IterationPdf({
  iteration,
  hideAssessments,
}: {
  iteration: IterationBlock;
  hideAssessments: boolean;
}) {
  return (
    <View style={styles.iterBox}>
      <View style={[styles.row, { justifyContent: "space-between", marginBottom: 4 }]}>
        <Text style={{ fontSize: 9, fontWeight: "bold" }}>
          {iteration.assetLabel ?? "기기 전체"}
        </Text>
        <Text
          style={[
            styles.badge,
            { backgroundColor: verdictColor(iteration.status) },
          ]}
        >
          {outcomeLabel(iteration.status)}
        </Text>
      </View>

      {iteration.pathSummary && (
        <View
          style={{
            padding: 4,
            backgroundColor: colors.primaryBg,
            borderRadius: 2,
            marginBottom: 4,
          }}
        >
          <Text style={[styles.muted, { color: colors.primary, fontSize: 7 }]}>
            DT 경로
          </Text>
          <Text style={styles.mono}>{iteration.pathSummary}</Text>
        </View>
      )}

      {iteration.evidenceFields.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.muted, { fontSize: 7, fontWeight: "bold", marginBottom: 3 }]}>
            증빙 정보
          </Text>
          {iteration.evidenceFields.map((f, i) => (
            <View
              key={i}
              style={{
                marginBottom: 3,
                padding: 4,
                borderWidth: 0.5,
                borderColor: colors.border,
                borderRadius: 2,
                backgroundColor: "#fff",
              }}
            >
              <Text style={[styles.muted, { fontSize: 7, fontFamily: "NotoSansKR" }]}>
                {f.field.id} — {f.field.prompt_ko}
              </Text>
              <Text style={{ fontSize: 8, marginTop: 2 }}>
                {f.value || "(미입력)"}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Customer view: show placeholder instead of assessment content */}
      {hideAssessments && iteration.assessments.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.muted, { fontSize: 7, fontWeight: "bold", marginBottom: 3 }]}>
            기능 평가
          </Text>
          <View
            style={{
              padding: 6,
              borderWidth: 0.5,
              borderColor: colors.border,
              borderStyle: "dashed",
              borderRadius: 2,
              backgroundColor: "#fafafa",
            }}
          >
            <Text style={{ fontSize: 8, textAlign: "center", color: colors.muted }}>
              컨설턴트 평가 중입니다. 평가가 완료되면 본 섹션에 내용이 표시됩니다.
            </Text>
          </View>
        </View>
      )}

      {!hideAssessments && iteration.assessments.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.muted, { fontSize: 7, fontWeight: "bold", marginBottom: 3 }]}>
            기능 평가
          </Text>
          {iteration.assessments.map((a, i) => (
            <View
              key={i}
              style={{
                marginBottom: 3,
                padding: 4,
                borderWidth: 0.5,
                borderColor: colors.border,
                borderRadius: 2,
                backgroundColor: "#fff",
              }}
            >
              <View style={[styles.row, { justifyContent: "space-between", marginBottom: 2 }]}>
                <Text style={{ fontSize: 8, fontWeight: "bold" }}>
                  {ASSESSMENT_LABEL_KO[a.type]}
                </Text>
                <Text
                  style={[
                    styles.badge,
                    { backgroundColor: verdictColor(a.verdict) },
                  ]}
                >
                  {verdictLabel(a.verdict)}
                </Text>
              </View>
              <View style={{ marginBottom: 2 }}>
                <Text style={[styles.muted, { fontSize: 7 }]}>테스트 방법</Text>
                <Text style={{ fontSize: 8 }}>{a.testMethod || "(미입력)"}</Text>
              </View>
              <View>
                <Text style={[styles.muted, { fontSize: 7 }]}>테스트 결과</Text>
                <Text style={{ fontSize: 8 }}>{a.testResult || "(미입력)"}</Text>
              </View>
              {a.attachmentFilename && (
                <Text style={[styles.muted, { fontSize: 7, marginTop: 2 }]}>
                  📎 {a.attachmentFilename}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  ensureFonts();
  const stream = await renderToStream(<ReportDocument data={data} />);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

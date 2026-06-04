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
  // Per-requirement functional assessment (assetId = null), shown once.
  assessments: Array<{
    type: AssessmentType;
    testMethod: string;
    testResult: string;
    verdict: VerdictValue;
    attachmentFilename: string | null;
  }>;
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
    reportNo: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  applicableStandards: StandardId[];
  sections: Record<number, StandardSection>;
  assets: Array<{ id: string; kind: string; name: string }>;
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
    assets: parsedAssets.map((a: { id: string; kind: string; name: string }) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
    })),
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

    let hasPassFail = false;
    for (const it of iterations) {
      stats.total++;
      if (it.status === "pass") {
        stats.pass++;
        hasPassFail = true;
      } else if (it.status === "fail") {
        stats.fail++;
        hasPassFail = true;
      } else if (it.status === "not_applicable" || it.status === "auto_na") stats.na++;
      else stats.pending++;
    }

    // Per-requirement functional assessment (assetId = null), read once.
    const blockAssessments: RequirementBlock["assessments"] = hasPassFail
      ? assessTypes.map((t) => {
          const rec = assessmentMap.get(`${req.id}::__global__::${t}`);
          return {
            type: t,
            testMethod: rec?.testMethod ?? "",
            testResult: rec?.testResult ?? "",
            verdict: rec?.verdict ?? null,
            attachmentFilename: rec?.attachmentFilename ?? null,
          };
        })
      : [];

    if (iterations.length > 0) {
      blocks.push({ req, iterations, assessments: blockAssessments });
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

  // Functional assessment is rendered once per requirement at the block level
  // (assetId = null), not per asset iteration.
  const assessments: IterationBlock["assessments"] = [];

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
  kvLabel: { color: colors.muted, fontSize: 8, width: 96 },
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
  // Content pages leave room for the fixed running header/footer.
  contentPage: {
    paddingTop: 46,
    paddingBottom: 42,
    paddingHorizontal: 36,
    fontFamily: "NotoSansKR",
    fontSize: 9,
    color: colors.text,
    lineHeight: 1.4,
  },
  // ── Cover ──
  coverPage: {
    paddingTop: 64,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontFamily: "NotoSansKR",
    color: colors.text,
  },
  brandWordmark: { fontSize: 30, fontWeight: "bold", color: colors.primary, letterSpacing: 1 },
  brandBy: { fontSize: 10, color: colors.muted, marginTop: 2 },
  coverRule: { height: 2, width: 64, backgroundColor: colors.primary, marginVertical: 22 },
  coverTitle: { fontSize: 21, fontWeight: "bold", lineHeight: 1.3 },
  coverSubtitle: { fontSize: 11, color: colors.muted, marginTop: 4 },
  coverProduct: { fontSize: 16, fontWeight: "bold", marginTop: 30 },
  coverMfr: { fontSize: 11, color: colors.muted, marginTop: 2 },
  coverMetaBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12 },
  coverMetaRow: { flexDirection: "row", marginBottom: 4 },
  coverMetaLabel: { fontSize: 8, color: colors.muted, width: 160 },
  coverMetaValue: { fontSize: 9, flex: 1 },
  confidential: { color: colors.fail, fontWeight: "bold", letterSpacing: 1 },
  // ── Running header / footer ──
  // Full-width absolute texts (BOTH left+right anchors set, aligned via
  // textAlign). A right-only anchor produces a bad x-translate that crashes
  // @react-pdf at render time.
  runHdrL: { position: "absolute", top: 20, left: 36, right: 36, fontSize: 7, color: colors.muted, textAlign: "left" },
  runHdrR: { position: "absolute", top: 20, left: 36, right: 36, fontSize: 7, color: colors.muted, textAlign: "right" },
  runFtrL: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: colors.muted, textAlign: "left" },
  runFtrR: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: colors.muted, textAlign: "right" },
  cellCenter: { textAlign: "center" },
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

function reportNumberOf(data: ReportData): string {
  // Use the persisted report number when finalized; otherwise a provisional one.
  if (data.project.reportNo) return data.project.reportNo;
  const d = data.project.finalizedAt ? new Date(data.project.finalizedAt) : data.generatedAt;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return `ZGRC-RED-${data.project.id.slice(0, 6).toUpperCase()}-${ymd}`;
}

function RunningMarks({ reportNo, productName }: { reportNo: string; productName: string }) {
  return (
    <View
      fixed
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 10,
        paddingBottom: 3,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 7, color: colors.muted }}>
        Z-GRC · {reportNo} · {productName}
      </Text>
      <Text
        style={{ fontSize: 7, color: colors.muted }}
        render={({ pageNumber }) => `CONFIDENTIAL · p.${pageNumber}`}
      />
    </View>
  );
}

function CoverMetaRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.coverMetaRow}>
      <Text style={styles.coverMetaLabel}>{label}</Text>
      <Text style={[styles.coverMetaValue, accent ? styles.confidential : {}]}>{value}</Text>
    </View>
  );
}

export function ReportDocument({ data }: { data: ReportData }) {
  const { project, applicableStandards, sections, assets, generatedAt } = data;
  const reportNo = reportNumberOf(data);
  const issueDate = (project.finalizedAt ? new Date(project.finalizedAt) : generatedAt).toLocaleDateString(
    "ko-KR",
  );
  const standardsLine =
    applicableStandards.length === 0
      ? "없음 / None"
      : applicableStandards.map((s) => `EN 18031-${s}`).join(", ");

  return (
    <Document title={`Report - ${project.name}`} author="Z-GRC by ZIEN">
      {/* ── Cover ── */}
      <Page size="A4" style={styles.coverPage}>
        <View>
          <Text style={styles.brandWordmark}>Z-GRC</Text>
          <Text style={styles.brandBy}>by ZIEN</Text>
        </View>
        <View style={{ flexGrow: 1, justifyContent: "center" }}>
          <View style={styles.coverRule} />
          <Text style={styles.coverTitle}>EN 18031 사이버보안 평가 보고서</Text>
          <Text style={styles.coverSubtitle}>EN 18031 Cybersecurity Assessment Report</Text>
          <Text style={styles.coverProduct}>{project.name}</Text>
          <Text style={styles.coverMfr}>{project.manufacturer}</Text>
        </View>
        <View style={styles.coverMetaBox}>
          <CoverMetaRow label="보고서 번호 / Report No." value={reportNo} />
          <CoverMetaRow label="버전 / Version" value="v1.0" />
          <CoverMetaRow label="적용 표준 / Standards" value={standardsLine} />
          {project.contactName && (
            <CoverMetaRow
              label="담당자 / Contact"
              value={`${project.contactName}${project.contactEmail ? ` <${project.contactEmail}>` : ""}`}
            />
          )}
          <CoverMetaRow
            label={project.finalizedAt ? "확정일 / Finalized" : "발행일 / Issued"}
            value={`${issueDate}${project.finalizedBy ? ` · ${project.finalizedBy}` : ""}`}
          />
          <CoverMetaRow label="기밀 / Classification" value="CONFIDENTIAL" accent />
        </View>
      </Page>

      {/* ── Front matter: overview + scope ── */}
      <Page size="A4" style={styles.contentPage}>
        <RunningMarks reportNo={reportNo} productName={project.name} />

        <Text style={styles.h2}>1. 결과 개요 / Results Overview</Text>
        <SummaryTable applicableStandards={applicableStandards} sections={sections} />

        <View style={{ marginTop: 14 }}>
          <Text style={styles.h2}>2. 평가 범위 및 방법론 / Scope &amp; Methodology</Text>
          <ScopeSection project={project} applicableStandards={applicableStandards} assets={assets} />
        </View>
      </Page>

      {/* ── Assessment results — one page (auto-paginated) per standard ── */}
      {applicableStandards.map((s, idx) => (
        <Page key={s} size="A4" style={styles.contentPage}>
          <RunningMarks reportNo={reportNo} productName={project.name} />
          <View style={styles.sectionHeader}>
            <Text style={{ fontSize: 13, fontWeight: "bold" }}>
              3.{idx + 1} {STANDARDS[s].name_ko}
            </Text>
          </View>
          {sections[s].blocks.length === 0 ? (
            <Text style={styles.muted}>해당 표준에 적용되는 요구사항이 없습니다.</Text>
          ) : (
            sections[s].blocks.map((block) => (
              <RequirementBlockPdf
                key={block.req.id}
                block={block}
                hideAssessments={data.hideAssessments}
              />
            ))
          )}
        </Page>
      ))}
    </Document>
  );
}

function SummaryTable({
  applicableStandards,
  sections,
}: {
  applicableStandards: StandardId[];
  sections: Record<number, StandardSection>;
}) {
  const totals = { total: 0, pass: 0, fail: 0, na: 0, pending: 0 };
  for (const s of applicableStandards) {
    const st = sections[s].stats;
    totals.total += st.total;
    totals.pass += st.pass;
    totals.fail += st.fail;
    totals.na += st.na;
    totals.pending += st.pending;
  }

  const Cell = ({ children, flex, color }: { children: number; flex: number; color?: string }) => (
    <Text style={[styles.tableCell, styles.cellCenter, { flex, ...(color ? { color } : {}) }]}>
      {children}
    </Text>
  );

  return (
    <View>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={[styles.tableCell, { flex: 4 }]}>표준 / Standard</Text>
          <Text style={[styles.tableCell, styles.cellCenter, { flex: 1 }]}>전체</Text>
          <Text style={[styles.tableCell, styles.cellCenter, { flex: 1 }]}>PASS</Text>
          <Text style={[styles.tableCell, styles.cellCenter, { flex: 1 }]}>FAIL</Text>
          <Text style={[styles.tableCell, styles.cellCenter, { flex: 1 }]}>N/A</Text>
          <Text style={[styles.tableCell, styles.cellCenter, { flex: 1 }]}>진행</Text>
        </View>
        {applicableStandards.map((s, i) => {
          const st = sections[s].stats;
          const last = i === applicableStandards.length - 1;
          return (
            <View key={s} style={last ? styles.tableRowLast : styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 4 }]}>
                {STANDARDS[s].name_ko}
              </Text>
              <Cell flex={1}>{st.total}</Cell>
              <Cell flex={1} color={colors.pass}>{st.pass}</Cell>
              <Cell flex={1} color={colors.fail}>{st.fail}</Cell>
              <Cell flex={1} color={colors.na}>{st.na}</Cell>
              <Cell flex={1} color={colors.pending}>{st.pending}</Cell>
            </View>
          );
        })}
      </View>
      {/* Totals row (separate, emphasized) */}
      <View style={[styles.tableRowLast, { backgroundColor: colors.bg, marginTop: 4, borderWidth: 0.5, borderColor: colors.border, borderRadius: 3 }]}>
        <Text style={[styles.tableCell, { flex: 4, fontWeight: "bold" }]}>합계 / Total</Text>
        <Text style={[styles.tableCell, styles.cellCenter, { flex: 1, fontWeight: "bold" }]}>{totals.total}</Text>
        <Text style={[styles.tableCell, styles.cellCenter, { flex: 1, fontWeight: "bold", color: colors.pass }]}>{totals.pass}</Text>
        <Text style={[styles.tableCell, styles.cellCenter, { flex: 1, fontWeight: "bold", color: colors.fail }]}>{totals.fail}</Text>
        <Text style={[styles.tableCell, styles.cellCenter, { flex: 1, fontWeight: "bold", color: colors.na }]}>{totals.na}</Text>
        <Text style={[styles.tableCell, styles.cellCenter, { flex: 1, fontWeight: "bold", color: colors.pending }]}>{totals.pending}</Text>
      </View>
      <Text style={[styles.muted, { marginTop: 6 }]}>
        총 {totals.total}개 평가 단위 · FAIL {totals.fail}건 · 진행중 {totals.pending}건
      </Text>
    </View>
  );
}

function ScopeSection({
  project,
  applicableStandards,
  assets,
}: {
  project: ReportData["project"];
  applicableStandards: StandardId[];
  assets: ReportData["assets"];
}) {
  return (
    <View>
      {/* Product overview */}
      <View style={styles.box}>
        <Text style={styles.h3}>제품 개요 / Product</Text>
        <View style={styles.kv}>
          <Text style={styles.kvLabel}>제품 / Product</Text>
          <Text style={styles.kvValue}>{project.name}</Text>
        </View>
        <View style={styles.kv}>
          <Text style={styles.kvLabel}>제조사 / Manufacturer</Text>
          <Text style={styles.kvValue}>{project.manufacturer}</Text>
        </View>
        {project.productType && (
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>유형 / Type</Text>
            <Text style={styles.kvValue}>{project.productType}</Text>
          </View>
        )}
        {project.productDescription && (
          <View style={{ marginTop: 4 }}>
            <Text style={[styles.muted, { fontSize: 7 }]}>설명 / Description</Text>
            <Text style={{ fontSize: 8 }}>{project.productDescription}</Text>
          </View>
        )}
      </View>

      {/* Applicable standards */}
      <View style={styles.box}>
        <Text style={styles.h3}>적용 표준 / Applicable Standards</Text>
        {applicableStandards.length === 0 ? (
          <Text style={styles.muted}>해당되는 EN 18031 표준이 없습니다. / None.</Text>
        ) : (
          applicableStandards.map((s) => (
            <Text key={s} style={{ fontSize: 8, marginBottom: 1 }}>
              • {STANDARDS[s].name_ko}
              {STANDARDS[s].article ? ` (${STANDARDS[s].article})` : ""}
            </Text>
          ))
        )}
      </View>

      {/* Methodology */}
      <View style={styles.box}>
        <Text style={styles.h3}>평가 방법 / Methodology</Text>
        <Text style={{ fontSize: 8 }}>
          본 평가는 EN 18031의 요구사항별 Decision Tree 평가와 기능 평가(테스트 방법·결과·판정)를 통해 수행되었습니다.
        </Text>
        <Text style={[styles.muted, { fontSize: 7, marginTop: 2 }]}>
          This assessment was conducted through EN 18031 per-requirement decision-tree evaluation and functional assessment (test method, result, verdict).
        </Text>
      </View>

      {/* Assets in scope */}
      <View style={styles.box}>
        <Text style={styles.h3}>대상 자산 / Assets in Scope ({assets.length})</Text>
        {assets.length === 0 ? (
          <Text style={styles.muted}>등록된 자산이 없습니다. / None.</Text>
        ) : (
          assets.map((a) => (
            <Text key={a.id} style={{ fontSize: 8, marginBottom: 1 }}>
              • {a.name} — {kindConfig(a.kind)?.title_ko ?? a.kind}
            </Text>
          ))
        )}
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
    <View style={styles.reqCard}>
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

      {/* Per-requirement functional assessment (shown once) */}
      {hideAssessments && block.assessments.length > 0 && (
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
      {!hideAssessments && block.assessments.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[styles.muted, { fontSize: 7, fontWeight: "bold", marginBottom: 3 }]}>
            기능 평가 (요구사항 단위)
          </Text>
          {block.assessments.map((a, i) => (
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
                  style={[styles.badge, { backgroundColor: verdictColor(a.verdict) }]}
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

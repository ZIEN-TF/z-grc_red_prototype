// LLM wrapper for the Z-GRC AI auto-fill feature (screening / assets / DT /
// instances / evidence / assessment). Backed by Claude (Anthropic) — the file
// name is kept as-is so existing imports don't change.
//
// Inlines a project's attachments so the model can read product manuals,
// architecture diagrams, vendor questionnaires, etc. Supported formats:
//   - Images (PNG/JPEG/GIF/WebP) → base64 image block
//   - PDFs                        → base64 document block
//   - .docx                       → HTML extracted via mammoth, as text
//   - .xlsx                       → per-sheet CSV via xlsx, as text
// Structured output is enforced via JSON Schema (output_config.format).

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다. .env에 키를 추가한 뒤 서버를 재시작하세요.",
      );
    }
    _client = new Anthropic({ maxRetries: 6 });
  }
  return _client;
}

// Model + effort are env-overridable. Opus 4.8 by default (most capable);
// drop to a cheaper model / lower effort via env if high call volume needs it.
const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-4-8";
const AI_EFFORT = (process.env.AI_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high"
  | "max";

export type AttachmentInput =
  | { kind: "image"; dataUrl: string; filename: string; description: string }
  | { kind: "file"; fileData: string; filename: string; description: string }
  | { kind: "text"; filename: string; description: string; text: string };

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAX_EXTRACTED_TEXT_CHARS = 60_000;

// Anthropic vision supports these media types (SVG is not supported).
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

async function extractDocxText(buf: Buffer): Promise<string> {
  const res = await mammoth.convertToHtml({ buffer: buf });
  return res.value;
}

function extractXlsxText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (csv.trim().length === 0) continue;
    out.push(`### Sheet: ${name}\n${csv}`);
  }
  return out.join("\n\n");
}

// Reads a project's uploaded attachments from disk, encoding each for inclusion
// in a Claude request. Office docs are extracted to text server-side. Firmware
// (kind="firmware") is excluded — it's handled by the firmware analysis path,
// not inlined here.
export async function loadProjectAttachmentsForAI(
  projectId: string,
): Promise<AttachmentInput[]> {
  const attachments = await prisma.projectAttachment.findMany({
    where: { projectId, kind: { not: "firmware" } },
    orderBy: { createdAt: "asc" },
  });
  const out: AttachmentInput[] = [];
  for (const a of attachments) {
    const fullPath = path.join(process.cwd(), "uploads", a.storedPath);
    const buf = await fs.readFile(fullPath).catch(() => null);
    if (!buf) continue;
    try {
      if (a.mimeType.startsWith("image/")) {
        out.push({
          kind: "image",
          dataUrl: `data:${a.mimeType};base64,${buf.toString("base64")}`,
          filename: a.filename,
          description: a.description,
        });
      } else if (a.mimeType === "application/pdf") {
        out.push({
          kind: "file",
          fileData: `data:${a.mimeType};base64,${buf.toString("base64")}`,
          filename: a.filename,
          description: a.description,
        });
      } else if (a.mimeType === DOCX_MIME) {
        const text = await extractDocxText(buf);
        if (text.trim().length > 0) {
          out.push({
            kind: "text",
            filename: a.filename,
            description: a.description,
            text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS),
          });
        }
      } else if (a.mimeType === XLSX_MIME) {
        const text = extractXlsxText(buf);
        if (text.trim().length > 0) {
          out.push({
            kind: "text",
            filename: a.filename,
            description: a.description,
            text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS),
          });
        }
      }
    } catch (err) {
      console.error(
        `Failed to extract attachment ${a.filename} (${a.mimeType}):`,
        err,
      );
    }
  }
  return out;
}

// Parse a data URL into { mediaType, base64 }.
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

// Run a structured-output AI call with a project's attachments via Claude.
// Same signature as before; the response is validated against `jsonSchema`
// (output_config.format) and parsed into T.
export async function runAIWithAttachments<T>(opts: {
  systemPrompt: string;
  userPrompt: string;
  attachments: AttachmentInput[];
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  model?: string;
}): Promise<T> {
  const client = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [{ type: "text", text: opts.userPrompt }];
  for (const a of opts.attachments) {
    if (a.kind === "image") {
      const parsed = parseDataUrl(a.dataUrl);
      if (parsed && SUPPORTED_IMAGE_TYPES.has(parsed.mediaType)) {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        });
      } else {
        userContent.push({
          type: "text",
          text: `[이미지 첨부 "${a.filename}" — 형식 미지원(예: SVG)으로 직접 읽지 못함: ${a.description || "(설명 없음)"}]`,
        });
        continue;
      }
    } else if (a.kind === "file") {
      const parsed = parseDataUrl(a.fileData);
      if (parsed) {
        userContent.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.data },
          title: a.filename,
        });
      }
    } else {
      userContent.push({
        type: "text",
        text: `=== 첨부 파일 본문 (텍스트 추출): "${a.filename}" — ${
          a.description || "(설명 없음)"
        } ===\n${a.text}\n=== 첨부 파일 본문 끝 ===`,
      });
      continue;
    }
    userContent.push({
      type: "text",
      text: `[첨부 파일 설명: "${a.filename}" — ${a.description || "(설명 없음)"}]`,
    });
  }

  const res = (await client.messages.create({
    model: opts.model ?? AI_MODEL,
    max_tokens: 8000,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: userContent }],
    output_config: {
      effort: AI_EFFORT,
      format: {
        type: "json_schema",
        name: opts.schemaName,
        schema: opts.jsonSchema,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as Anthropic.Message;

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("AI가 응답을 반환하지 않았습니다.");
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    console.error("AI JSON parse error:", err, "raw:", text);
    throw new Error("AI 응답을 JSON으로 해석할 수 없습니다.");
  }
}

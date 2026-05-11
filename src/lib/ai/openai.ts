// OpenAI client wrapper for the Z-GRC AI auto-fill feature.
//
// Uses the Responses API (gpt-4o for vision, gpt-4o-mini for text-only) and
// supports inlining a project's attachments so the model can read product
// manuals, architecture diagrams, vendor questionnaires, etc. when filling
// in screening / DT / evidence / assessment fields. Supported attachment
// formats:
//   - Images (PNG/JPEG/SVG) → base64 data URL inlined as input_image
//   - PDFs                  → base64 file_data inlined as input_file
//   - .docx                 → text extracted via mammoth, inlined as input_text
//   - .xlsx                 → per-sheet CSV extracted via xlsx, inlined as input_text
// Structured output is enforced via JSON Schema.

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY 환경 변수가 설정되지 않았습니다. .env.local에 키를 추가한 뒤 서버를 재시작하세요.",
      );
    }
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

// Models — switch via env if you want to override per environment.
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-4o-mini";

export type AttachmentInput =
  | {
      kind: "image";
      dataUrl: string;
      filename: string;
      description: string;
    }
  | {
      kind: "file";
      fileData: string; // "data:application/pdf;base64,..."
      filename: string;
      description: string;
    }
  | {
      // Text extracted from Office docs (docx/xlsx) — included as plain text
      // since OpenAI's input_file does not natively support these formats.
      kind: "text";
      filename: string;
      description: string;
      text: string;
    };

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Truncate extracted text to keep the prompt size and cost predictable.
const MAX_EXTRACTED_TEXT_CHARS = 60_000;

async function extractDocxText(buf: Buffer): Promise<string> {
  const res = await mammoth.extractRawText({ buffer: buf });
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

// Reads a project's uploaded attachments from disk, encoding each one for
// inclusion in an OpenAI Responses API request. Office documents are
// extracted to plain text server-side (OpenAI's API cannot read docx/xlsx
// directly) and passed as additional input_text blocks.
export async function loadProjectAttachmentsForAI(
  projectId: string,
): Promise<AttachmentInput[]> {
  const attachments = await prisma.projectAttachment.findMany({
    where: { projectId },
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
      // .doc / .xls (legacy binary) and unknown types still skipped.
    } catch (err) {
      console.error(
        `Failed to extract attachment ${a.filename} (${a.mimeType}):`,
        err,
      );
    }
  }
  return out;
}

// Run a structured-output AI call with a project's attachments. The model is
// instructed via `systemPrompt` and asked the question via `userPrompt`; all
// loaded attachments are appended as multimodal inputs. The response is
// validated against `jsonSchema` and parsed into T.
export async function runAIWithAttachments<T>(opts: {
  systemPrompt: string;
  userPrompt: string;
  attachments: AttachmentInput[];
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /** Defaults to VISION_MODEL when attachments are present, TEXT_MODEL otherwise. */
  model?: string;
}): Promise<T> {
  const client = getOpenAI();
  const model =
    opts.model ?? (opts.attachments.length > 0 ? VISION_MODEL : TEXT_MODEL);

  // Build the user content array: prompt text + each attachment + a small
  // descriptor line per attachment so the model knows what each one is.
  const userContent: Array<Record<string, unknown>> = [
    { type: "input_text", text: opts.userPrompt },
  ];
  for (const a of opts.attachments) {
    if (a.kind === "image") {
      userContent.push({ type: "input_image", image_url: a.dataUrl });
    } else if (a.kind === "file") {
      userContent.push({
        type: "input_file",
        filename: a.filename,
        file_data: a.fileData,
      });
    } else {
      // Text-extracted attachment (docx/xlsx) — wrap with delimiters so the
      // model can clearly separate it from the surrounding prompt.
      userContent.push({
        type: "input_text",
        text: `=== 첨부 파일 본문 (텍스트 추출): "${a.filename}" — ${
          a.description || "(설명 없음)"
        } ===\n${a.text}\n=== 첨부 파일 본문 끝 ===`,
      });
      continue;
    }
    userContent.push({
      type: "input_text",
      text: `[첨부 파일 설명: "${a.filename}" — ${
        a.description || "(설명 없음)"
      }]`,
    });
  }

  // The OpenAI Node SDK's Responses input typing is permissive — we cast to
  // bypass strict typing of the content union since we're building it
  // dynamically.
  const res = await client.responses.create({
    model,
    input: [
      { role: "system", content: opts.systemPrompt },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "user", content: userContent as any },
    ],
    text: {
      format: {
        type: "json_schema",
        name: opts.schemaName,
        schema: opts.jsonSchema,
        strict: true,
      },
    },
  });

  const text = res.output_text?.trim();
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

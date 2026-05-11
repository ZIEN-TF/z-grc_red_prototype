import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

// GET /api/evidence-attachments?projectId=…&assetId=…&requirementId=…&fieldId=…
// Streams the attachment file for a single evidence field.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const assetIdParam = searchParams.get("assetId");
  const requirementId = searchParams.get("requirementId");
  const fieldId = searchParams.get("fieldId");
  if (!projectId || !requirementId || !fieldId) {
    return new NextResponse("Missing parameters", { status: 400 });
  }
  const assetId = assetIdParam && assetIdParam !== "" ? assetIdParam : null;

  const rec = await prisma.dTEvidence.findFirst({
    where: {
      projectId,
      assetId,
      requirementId,
      fieldId,
    },
  });
  if (!rec || !rec.attachmentStoredPath) {
    return new NextResponse("Not found", { status: 404 });
  }
  const fullPath = path.join(process.cwd(), "uploads", rec.attachmentStoredPath);
  try {
    const buffer = await fs.readFile(fullPath);
    const encodedName = encodeURIComponent(rec.attachmentFilename ?? "attachment");
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": rec.attachmentMimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return new NextResponse("File missing on disk", { status: 410 });
  }
}

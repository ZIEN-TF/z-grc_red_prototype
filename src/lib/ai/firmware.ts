// Firmware analysis — runs ONCE per firmware, server-side only (Linux + Docker).
//
// Heavy step: binwalk extraction + a fixed set of read-only probes inside an
// isolated container (--network=none, read-only data mount). The result is a
// compact `findings` JSON persisted on FirmwareAnalysis; the AI pipeline reads
// that summary instead of re-reading the firmware. `inspectFirmware()` lets a
// later step drill down into the already-extracted rootfs (cheap grep/cat — no
// re-extraction) when the summary is insufficient.
//
// On Windows/dev (no Docker) this throws at runtime; the code typechecks and
// runs on the deployed Linux server where the analyzer image is built.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const exec = promisify(execFile);

// Host paths / config (overridable via env on the server).
const FW_WORK_ROOT = process.env.FW_WORK_DIR ?? "/srv/fw";
const FW_IMAGE = process.env.FW_ANALYZER_IMAGE ?? "zgrc-binwalk:latest";
const DOCKER = process.env.DOCKER_BIN ?? "docker";
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

// Truncate any single probe output so findings stay small (token budget).
const MAX_PROBE_CHARS = 4000;

export type FirmwareFindings = {
  firmwareFile: string;
  extractedAt: string;
  // Each probe: a human-readable label → (truncated) command output.
  probes: Record<string, string>;
  notes: string[];
};

// Read-only probes run over the extraction dir (/data). Keep them defensive:
// every probe tolerates "not found" and never fails the whole analysis.
const PROBES: Array<{ key: string; sh: string }> = [
  { key: "tree", sh: "find /data -maxdepth 4 -type d | head -200" },
  { key: "os_release", sh: "cat $(find /data -name os-release 2>/dev/null | head -3) 2>/dev/null" },
  { key: "passwd", sh: "cat $(find /data -path '*/etc/passwd' 2>/dev/null | head -3) 2>/dev/null" },
  { key: "shadow", sh: "cat $(find /data -path '*/etc/shadow' 2>/dev/null | head -3) 2>/dev/null" },
  { key: "private_keys", sh: "grep -rlI 'PRIVATE KEY' /data 2>/dev/null | head -50" },
  { key: "certs_keys_files", sh: "find /data -type f \\( -name '*.pem' -o -name '*.key' -o -name '*.crt' -o -name '*.p12' -o -name '*.der' \\) 2>/dev/null | head -100" },
  { key: "init_services", sh: "ls -1 $(find /data -path '*/etc/init.d' -o -path '*/etc/rc.d' 2>/dev/null | head -3) 2>/dev/null; find /data -path '*/systemd/system/*.service' 2>/dev/null | head -50" },
  { key: "remote_access", sh: "find /data -type f \\( -name 'dropbear*' -o -name 'sshd*' -o -name 'telnetd*' -o -name 'busybox' \\) 2>/dev/null | head -50" },
  { key: "network_config", sh: "find /data -path '*/etc/*' \\( -name '*.conf' -o -name 'inittab' \\) 2>/dev/null | head -100" },
  { key: "tls_config", sh: "grep -rIl -e 'ssl' -e 'tls' /data 2>/dev/null | head -50" },
  { key: "update_mechanism", sh: "find /data -type f \\( -iname '*update*' -o -iname '*ota*' -o -iname '*upgrade*' \\) 2>/dev/null | head -80" },
  { key: "package_versions", sh: "for f in $(find /data -name '*.ipk' -o -name 'opkg' -o -name 'dpkg' 2>/dev/null | head -5); do echo $f; done; cat $(find /data -name 'manifest' 2>/dev/null | head -3) 2>/dev/null | head -100" },
  { key: "hardcoded_secrets", sh: "grep -rEoI '(password|passwd|secret|api[_-]?key|token)[\"\\x27 ]*[:=][^\\n]{0,40}' /data 2>/dev/null | head -80" },
];

function workDirFor(analysisId: string): string {
  return path.join(FW_WORK_ROOT, analysisId);
}

// Run a shell command inside the isolated analyzer container over the extracted
// firmware (mounted read-only at /data, no network). Returns truncated stdout.
async function inContainer(extractDir: string, sh: string): Promise<string> {
  const { stdout } = await exec(
    DOCKER,
    [
      "run", "--rm",
      "--network=none",
      "--memory=4g", "--cpus=2",
      "-v", `${extractDir}:/data:ro`,
      FW_IMAGE,
      "sh", "-c", sh,
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  ).catch((err: unknown) => ({ stdout: `((probe error: ${err instanceof Error ? err.message : String(err)}))` }));
  return stdout.slice(0, MAX_PROBE_CHARS);
}

// Public: drill down into an already-extracted firmware (no re-extraction).
export async function inspectFirmware(
  analysisId: string,
  shellCommand: string,
): Promise<string> {
  const extractDir = path.join(workDirFor(analysisId), "extracted");
  return inContainer(extractDir, shellCommand);
}

// Run the full one-time analysis for a FirmwareAnalysis row: extract + probe.
export async function runFirmwareAnalysis(analysisId: string): Promise<FirmwareFindings> {
  const analysis = await prisma.firmwareAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw new Error(`FirmwareAnalysis ${analysisId} not found`);

  const attachment = analysis.attachmentId
    ? await prisma.projectAttachment.findUnique({ where: { id: analysis.attachmentId } })
    : await prisma.projectAttachment.findFirst({
        where: { projectId: analysis.projectId, kind: "firmware" },
      });
  if (!attachment) throw new Error("No firmware attachment found for analysis");

  const fwPath = path.join(UPLOADS_ROOT, attachment.storedPath);
  const work = workDirFor(analysisId);
  const extractDir = path.join(work, "extracted");

  await prisma.firmwareAnalysis.update({
    where: { id: analysisId },
    data: { status: "extracting", startedAt: new Date(), extractedPath: extractDir },
  });

  await fs.mkdir(extractDir, { recursive: true });

  // binwalk extraction inside the container (firmware mounted read-only).
  await exec(
    DOCKER,
    [
      "run", "--rm",
      "--network=none",
      "--memory=4g", "--cpus=2",
      "-v", `${fwPath}:/in/firmware:ro`,
      "-v", `${extractDir}:/out`,
      FW_IMAGE,
      "sh", "-c", "cd /out && binwalk -e --run-as=root -C /out /in/firmware || binwalk -e -C /out /in/firmware",
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 600_000 },
  );

  await prisma.firmwareAnalysis.update({
    where: { id: analysisId },
    data: { status: "analyzing" },
  });

  const probes: Record<string, string> = {};
  for (const p of PROBES) {
    probes[p.key] = await inContainer(extractDir, p.sh);
  }

  const findings: FirmwareFindings = {
    firmwareFile: attachment.filename,
    extractedAt: new Date().toISOString(),
    probes,
    notes: [
      "Static analysis of the extracted firmware filesystem. Dynamic/runtime tests require the physical device.",
    ],
  };

  await prisma.firmwareAnalysis.update({
    where: { id: analysisId },
    data: { status: "done", findings: JSON.stringify(findings), finishedAt: new Date() },
  });

  return findings;
}

// Render findings as a compact text block for prompt grounding.
export function findingsToText(findings: FirmwareFindings): string {
  const parts = [`Firmware: ${findings.firmwareFile} (analyzed ${findings.extractedAt})`];
  for (const [k, v] of Object.entries(findings.probes)) {
    if (v && v.trim()) parts.push(`## ${k}\n${v.trim()}`);
  }
  return parts.join("\n\n");
}

export function parseFindings(json: string): FirmwareFindings | null {
  try {
    const f = JSON.parse(json);
    if (f && typeof f === "object" && f.probes) return f as FirmwareFindings;
  } catch {}
  return null;
}

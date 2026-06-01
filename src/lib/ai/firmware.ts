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
const MAX_PROBE_CHARS = 2500;

export type FirmwareFindings = {
  firmwareFile: string;
  extractedAt: string;
  // Each probe: a human-readable label → (truncated) command output.
  probes: Record<string, string>;
  notes: string[];
};

// Read-only probes run over the extraction dir (/data). Ordered most-important
// first (the findings text is capped, so earlier probes are likelier to reach
// the model). Each is defensive: tolerates "not found", never fails the run.
// `find ... -path '*/etc/passwd'` style means the probe works no matter where
// the rootfs landed inside the (possibly nested) extraction tree.
const PROBES: Array<{ key: string; sh: string }> = [
  // ── accounts / default credentials → ACM, AUM, GEC ──
  { key: "accounts_passwd", sh: "for f in $(find /data -path '*/etc/passwd' 2>/dev/null | head -5); do echo \"== $f\"; cat \"$f\" 2>/dev/null; done" },
  { key: "shadow_hashes", sh: "for f in $(find /data -path '*/etc/shadow' 2>/dev/null | head -5); do echo \"== $f\"; cat \"$f\" 2>/dev/null; done" },
  { key: "hardcoded_secrets", sh: "grep -rEoa '(password|passwd|secret|api[_-]?key|token|psk)[ =:].{0,48}' /data 2>/dev/null | head -80" },
  // ── keys / certs → CCK, SSM, SCM ──
  { key: "private_keys", sh: "grep -rla 'PRIVATE KEY' /data 2>/dev/null | head -50" },
  { key: "certs_and_keys", sh: "find /data -type f \\( -name '*.pem' -o -name '*.key' -o -name '*.crt' -o -name '*.cer' -o -name '*.der' -o -name '*.p12' -o -name '*.pfx' \\) 2>/dev/null | head -80" },
  { key: "ssh_host_keys", sh: "find /data -type f \\( -name 'ssh_host_*' -o -name 'dropbear_*key*' -o -name 'authorized_keys' \\) 2>/dev/null | head -40" },
  // ── remote access / services → ACM, GEC ──
  { key: "remote_access_daemons", sh: "find /data -type f \\( -name 'telnetd' -o -name 'dropbear' -o -name 'sshd' -o -name 'ftpd' -o -name 'tftpd' -o -name 'adbd' -o -name 'busybox' \\) 2>/dev/null | head -40" },
  { key: "services_startup", sh: "find /data \\( -path '*/etc/init.d/*' -o -path '*/etc/rc*.d/*' -o -path '*/systemd/system/*.service' -o -path '*/etc/inittab' \\) 2>/dev/null | head -80" },
  { key: "exposed_services_config", sh: "find /data -path '*etc*' -type f \\( -name 'uhttpd*' -o -name 'lighttpd*' -o -name 'nginx*' -o -name 'httpd*' -o -name 'inetd*' -o -name 'xinetd*' \\) 2>/dev/null | head -60" },
  // ── secure update → SUM ──
  { key: "update_mechanism", sh: "find /data -type f \\( -iname '*update*' -o -iname '*upgrade*' -o -iname '*ota*' -o -iname '*sysupgrade*' \\) 2>/dev/null | head -60" },
  { key: "update_signature_strings", sh: "for b in $(find /data -type f \\( -iname '*update*' -o -iname '*ota*' -o -iname '*upgrade*' \\) 2>/dev/null | head -6); do echo \"== $b\"; strings \"$b\" 2>/dev/null | grep -iE 'verify|signature|rsa|sha256|pubkey|x509|certificate' | head -6; done" },
  // ── TLS / crypto → SCM, CRY ──
  { key: "tls_crypto_libs", sh: "for b in $(find /data -type f \\( -name 'openssl' -o -name 'libssl*' -o -name 'libcrypto*' -o -name 'libwolfssl*' -o -name 'libmbed*' \\) 2>/dev/null | head -8); do echo \"== $b\"; strings \"$b\" 2>/dev/null | grep -iE 'openssl [0-9]|tlsv1|sslv3|rc4|des-cbc|md5|wolfssl [0-9]|mbed tls [0-9]' | head -6; done" },
  // ── component inventory (SBOM) → GEC ──
  { key: "package_inventory", sh: "for f in $(find /data \\( -path '*usr/lib/opkg/status' -o -path '*var/lib/dpkg/status' -o -name 'manifest' \\) 2>/dev/null | head -3); do echo \"== $f\"; grep -iE '^Package:|^Version:' \"$f\" 2>/dev/null | head -120; done; for b in $(find /data -name busybox 2>/dev/null | head -1); do strings \"$b\" 2>/dev/null | grep -iE 'BusyBox v[0-9]' | head -1; done" },
  { key: "os_release_banner", sh: "for f in $(find /data \\( -name os-release -o -name openwrt_release -o -name issue -o -name version -o -name banner \\) 2>/dev/null | head -8); do echo \"== $f\"; head -10 \"$f\" 2>/dev/null; done" },
  // ── privilege / hardening → GEC, ACM ──
  { key: "setuid_world_writable", sh: "echo '-- setuid --'; find /data -type f -perm -4000 2>/dev/null | head -30; echo '-- world-writable --'; find /data -type f -perm -0002 2>/dev/null | head -20" },
  // ── boot / network config → SUM, TCM, GEC ──
  { key: "bootloader", sh: "find /data -type f \\( -iname 'u-boot*' -o -iname 'uEnv.txt' -o -iname 'boot.cmd' -o -iname '*.dtb' \\) 2>/dev/null | head -30" },
  { key: "network_firewall_config", sh: "find /data -type f \\( -name 'firewall*' -o -name 'iptables*' -o -path '*etc/config/*' -o -path '*etc/*.conf' \\) 2>/dev/null | head -60" },
  // ── overall structure (context) ──
  { key: "rootfs_tree", sh: "find /data -maxdepth 6 -type d 2>/dev/null | head -150" },
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
      // -M = recursive (matryoshka) so a rootfs nested inside an outer wrapper
      // is reached. --run-as=root is required because the container runs as root.
      "sh", "-c",
      "cd /out && (binwalk -e -M --run-as=root -C /out /in/firmware || binwalk -e -M -C /out /in/firmware || binwalk -e -C /out /in/firmware)",
    ],
    { maxBuffer: 64 * 1024 * 1024, timeout: 900_000 },
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

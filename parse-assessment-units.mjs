// Extract assessment-unit blocks (purpose / units / verdict) per requirement
// from the plain-text dumps of BS EN 18031-1/2/3:2024.
//
// Strategy: walk lines, track current requirement ([REQ-N] header) and current
// assessment case (Conceptual / Functional completeness / Functional
// sufficiency), and capture the full text between the target sub-headers
// (Assessment purpose / Assessment units / Assignment of verdict). Capturing
// the WHOLE units block guarantees all implementation categories are included.
import fs from "fs";

const SOURCES = [
  { std: 1, file: "pdf1.txt" },
  { std: 2, file: "pdf2.txt" },
  { std: 3, file: "pdf3.txt" },
];

const isNoise = (l) =>
  /^BS EN 18031/.test(l) ||
  /^EN 18031-\d:2024 \(E\)$/.test(l) ||
  /^-{1,3} \d+ of \d+ -{1,3}$/.test(l) ||
  /^\d{1,3}$/.test(l.trim()); // bare page number

const REQ_HEADER =
  /^(\d+(?:\.\d+)*)\s+\[([A-Z]{2,4}-[0-9]+(?:-[0-9]+)*)\]\s*(.*)$/;
const CASE_HEADER =
  /^(\d+(?:\.\d+)*)\s+(Conceptual assessment|Functional completeness assessment|Functional sufficiency assessment)\s*$/;
// Number prefix optional — some sections (e.g. P3.SCM-1 sufficiency) print a
// bare "Assessment units" line with no clause number.
const SUB_HEADER =
  /^(?:(\d+(?:\.\d+)*)\s+)?(Assessment purpose|Preconditions|Assessment units?|Assignment of verdict)\s*$/;
// "Assessment criteria <qualifier>" — split families (e.g. AUM-1 has separate
// "Assessment criteria network interface" / "user interface" sections, one per
// child requirement, in order). Plain "Assessment criteria" (no qualifier)
// belongs to the current standalone requirement.
const AC_HEADER = /^(\d+(?:\.\d+)*)\s+Assessment criteria(?:\s+(.+))?$/;
const ANY_HEADER = /^(\d+(?:\.\d+)*)\s+\S/;
const isChildCode = (c) => /^[A-Z]{2,4}-\d+-\d+$/.test(c);
const familyOf = (c) => c.replace(/-\d+$/, "");

const CASE_KEY = {
  "Conceptual assessment": "conceptual",
  "Functional completeness assessment": "completeness",
  "Functional sufficiency assessment": "sufficiency",
};
const SUB_KEY = {
  "Assessment purpose": "purpose",
  "Assessment units": "units",
  "Assessment unit": "units",
  "Assignment of verdict": "verdict",
  Preconditions: "_skip",
};

function cleanup(text) {
  return text
    .replace(/([A-Za-z.\]])-\s+(\d)/g, "$1-$2") // rejoin "ACM- 1" -> "ACM-1"
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const out = {};

for (const { std, file } of SOURCES) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let req = null;
  let kase = null;
  let sub = null;
  let childQueue = []; // child IDs of the current split family, in order
  let acIdx = 0; // how many qualified "Assessment criteria X" sections consumed
  let curFam = null;
  const buf = {}; // req::case::sub -> string[]

  const push = (line) => {
    if (!req || !kase || !sub || sub === "_skip") return;
    const k = `${req}::${kase}::${sub}`;
    (buf[k] ??= []).push(line);
  };

  for (const raw of lines) {
    const line = raw.replace(/ /g, " ");
    if (isNoise(line)) continue;

    let m;
    if ((m = line.match(REQ_HEADER))) {
      const code = m[2];
      if (isChildCode(code)) {
        const fam = familyOf(code);
        if (fam !== curFam) {
          childQueue = [];
          acIdx = 0;
          curFam = fam;
        }
        childQueue.push(code);
      } else {
        // standalone or family-parent header — reset split-family tracking
        childQueue = [];
        acIdx = 0;
        curFam = null;
      }
      req = `P${std}.${code}`;
      kase = null;
      sub = null;
      (out[req] ??= { id: req, std, clause: m[1], title: m[3].trim(), cases: {} });
      continue;
    }
    if ((m = line.match(AC_HEADER))) {
      // Qualified "Assessment criteria X" → re-scope to next child in order.
      if (m[2] && childQueue.length > acIdx) {
        req = `P${std}.${childQueue[acIdx]}`;
        acIdx++;
        (out[req] ??= { id: req, std, clause: m[1], title: "", cases: {} });
      }
      // Plain "Assessment criteria" keeps the current standalone req.
      kase = null;
      sub = null;
      continue;
    }
    if ((m = line.match(CASE_HEADER))) {
      kase = CASE_KEY[m[2]];
      sub = null;
      if (req) (out[req].cases[kase] ??= {});
      continue;
    }
    if ((m = line.match(SUB_HEADER))) {
      sub = SUB_KEY[m[2]];
      continue;
    }
    // Any other numbered header ends the current capture block.
    if (ANY_HEADER.test(line)) {
      sub = null;
      // A case heading with free text and no sub-headers (e.g. ACM-2
      // completeness "covered by sufficiency") — leave kase so the note is
      // captured below via the _note path.
      continue;
    }
    // Body text
    if (req && kase && sub && sub !== "_skip") {
      push(line.trim());
    } else if (req && kase && sub === null) {
      // free text right under a case header (no sub-sections)
      const k = `${req}::${kase}::_note`;
      (buf[k] ??= []).push(line.trim());
    }
  }

  // Fold buffers into out
  for (const [k, arr] of Object.entries(buf)) {
    const [r, c, s] = k.split("::");
    if (!out[r]) continue;
    out[r].cases[c] ??= {};
    out[r].cases[c][s] = cleanup(arr.join("\n"));
  }
}

fs.writeFileSync("assessment-units-raw.json", JSON.stringify(out, null, 2), "utf8");

// Summary
const reqs = Object.keys(out).sort();
let cases = 0;
for (const r of reqs) cases += Object.keys(out[r].cases).length;
console.log(`requirements: ${reqs.length}, case-blocks: ${cases}`);
console.log(reqs.join(", "));

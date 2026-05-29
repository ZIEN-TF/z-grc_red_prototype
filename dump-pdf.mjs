import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import fs from "fs";

const path = process.argv[2];
const out = process.argv[3];
const buf = fs.readFileSync(path);
const parser = new PDFParse({ data: new Uint8Array(buf) });
const result = await parser.getText();
if (out) {
  fs.writeFileSync(out, result.text, "utf8");
  console.log(`wrote ${result.text.length} chars to ${out}`);
} else {
  console.log(result.text);
}

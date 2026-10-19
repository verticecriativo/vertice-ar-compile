// Determinism harness for MindAR image-target compilation.
//
// Compiles the same image twice in one process and prints the sha256 of each .mind, so the claim
// "recompile this target and get the same bytes" can be checked rather than assumed. Pass a
// reference .mind as the second argument to compare against an independently produced one (e.g.
// the browser tool's output).
//
//   node det.mjs <image> [reference.mind]
//
// GOTCHA: the image MUST be loaded with mind-ar's OWN nested canvas. mind-ar pins canvas 2.11.2
// under itself; a top-level canvas (3.x) is a different native instance and the compiler throws
// "Image or Canvas expected", because native modules do not cross instances.
import { OfflineCompiler } from "mind-ar/src/image-target/offline-compiler.js";
import { loadImage } from "mind-ar/node_modules/canvas/index.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

const sha = (b) => createHash("sha256").update(Buffer.from(b)).digest("hex");

const image = process.argv[2];
const reference = process.argv[3];
if (!image) {
  console.error("usage: node det.mjs <image> [reference.mind]");
  process.exit(2);
}

async function compileOnce(label) {
  const img = await loadImage(image);
  const compiler = new OfflineCompiler();
  await compiler.compileImageTargets([img], () => {});
  const buf = Buffer.from(await compiler.exportData());
  console.log(`${label.padEnd(26)} bytes=${String(buf.length).padStart(8)}  sha256=${sha(buf)}`);
  return sha(buf);
}

const a = await compileOnce("compile #1");
const b = await compileOnce("compile #2 (same process)");
console.log(`\nin-process identical: ${a === b}`);

if (reference) {
  const ref = readFileSync(reference);
  console.log(`${"reference".padEnd(26)} bytes=${String(ref.length).padStart(8)}  sha256=${sha(ref)}`);
  console.log(`matches reference:    ${a === sha(ref)}`);
}

// exit 0 = deterministic in-process, 1 = NOT. Nothing here asserts cross-implementation equality.
process.exit(a === b ? 0 : 1);

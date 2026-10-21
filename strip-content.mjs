/**
 * Find (and optionally delete) stock weapons and races in packs/_source.
 *
 * Run from the repo root:
 *   npm ls js-yaml || npm install --no-save js-yaml     (only needed if your files are .yml)
 *   node strip-source.mjs            # dry run: lists what would be deleted, deletes nothing
 *   node strip-source.mjs --delete   # deletes the files (undo with `git checkout -- packs`)
 *
 * Rules (edit RULES to change them):
 *   items, equipment24 : every document with type "weapon"
 *   origins24          : every "race" document, and every "feat" whose system.type.value is "race"
 *   races              : the whole pack folder
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "packs/_source";
const DELETE = process.argv.includes("--delete");

const RULES = {
  items: d => d.type === "weapon",
  equipment24: d => d.type === "weapon",
  origins24: d => (d.type === "race") || ((d.type === "feat") && (d.system?.type?.value === "race"))
};
const WHOLE_PACKS = ["races"];

let yaml;
try { yaml = (await import("js-yaml")).default; } catch { /* only required for .yml files */ }

function* walk(dir) {
  for ( const e of fs.readdirSync(dir, { withFileTypes: true }) ) {
    const full = path.join(dir, e.name);
    if ( e.isDirectory() ) yield* walk(full);
    else yield full;
  }
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  if ( file.endsWith(".json") ) return JSON.parse(text);
  if ( /\.ya?ml$/.test(file) ) {
    if ( !yaml ) throw new Error("js-yaml is needed: npm install --no-save js-yaml");
    return yaml.load(text);
  }
  return null;
}

if ( !fs.existsSync(ROOT) ) throw new Error(`Run this from the repo root (${ROOT} not found).`);

const matches = [];
const skipped = [];
for ( const [pack, rule] of Object.entries(RULES) ) {
  const dir = path.join(ROOT, pack);
  if ( !fs.existsSync(dir) ) { console.log(`(no ${dir})`); continue; }
  let total = 0;
  for ( const file of walk(dir) ) {
    let doc;
    try { doc = parse(file); } catch(err) { skipped.push(`${file}: ${err.message}`); continue; }
    if ( !doc || path.basename(file).startsWith("_") ) continue;   // folder definition files
    total++;
    if ( rule(doc) ) matches.push({ pack, file, name: doc.name, type: doc.type });
  }
  console.log(`${pack}: scanned ${total} documents`);
}

console.log("");
for ( const pack of Object.keys(RULES) ) {
  const list = matches.filter(m => m.pack === pack);
  console.log(`== ${pack}: ${list.length} to remove ==`);
  for ( const m of list ) console.log(`  [${m.type}] ${m.name}  (${m.file})`);
}
for ( const pack of WHOLE_PACKS ) {
  const dir = path.join(ROOT, pack);
  if ( fs.existsSync(dir) ) console.log(`== ${pack}: entire folder (${[...walk(dir)].length} files) ==`);
}
if ( skipped.length ) console.log(`\nCould not read ${skipped.length} files:\n  ${skipped.join("\n  ")}`);

if ( !DELETE ) {
  console.log("\nDry run only. Re-run with --delete to remove these files.");
  process.exit(0);
}
for ( const m of matches ) fs.rmSync(m.file);
for ( const pack of WHOLE_PACKS ) fs.rmSync(path.join(ROOT, pack), { recursive: true, force: true });
console.log("\nDeleted. Review with `git status`, undo with `git checkout -- packs`.");

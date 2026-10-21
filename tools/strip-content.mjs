/**
 * Strip stock weapons and races from the compiled compendium packs.
 *
 * Usage (from the system's root folder, with Foundry CLOSED):
 *   npm install --no-save @foundryvtt/foundryvtt-cli
 *   node tools/strip-content.mjs            # dry run: reports what would be removed, changes nothing
 *   node tools/strip-content.mjs --apply    # rewrites the packs (originals kept in packs/_backup)
 *
 * The `races` pack is removed in system.json and by `--apply` (its folder is deleted). Mixed packs are
 * filtered entry by entry using the rules below. Add or remove rules to change what gets stripped.
 */
import { extractPack, compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const APPLY = process.argv.includes("--apply");
const PACKS = "packs";

/** Pack name => predicate returning true for documents that should be removed. */
const RULES = {
  items: doc => doc.type === "weapon",
  equipment24: doc => doc.type === "weapon",
  origins24: doc => (doc.type === "race") || ((doc.type === "feat") && (doc.system?.type?.value === "race"))
};

/** Packs removed outright (also remove them from system.json). */
const REMOVE_PACKS = ["races"];

async function readJsonFiles(dir) {
  const out = [];
  for ( const entry of await fs.readdir(dir, { withFileTypes: true }) ) {
    const full = path.join(dir, entry.name);
    if ( entry.isDirectory() ) out.push(...await readJsonFiles(full));
    else if ( entry.name.endsWith(".json") ) out.push({ file: full, data: JSON.parse(await fs.readFile(full, "utf8")) });
  }
  return out;
}

async function filterPack(name, rule) {
  const packDir = path.join(PACKS, name);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `strip-${name}-`));
  const src = path.join(tmp, "src");
  await extractPack(packDir, src, { log: false });

  const files = await readJsonFiles(src);
  const isFolder = f => String(f.data._key ?? "").startsWith("!folders!");
  const removed = files.filter(f => !isFolder(f) && rule(f.data));
  const removedSet = new Set(removed.map(f => f.file));

  // Keep only folders that are still an ancestor of a remaining document.
  const folders = new Map(files.filter(isFolder).map(f => [f.data._id, f]));
  const needed = new Set();
  for ( const f of files ) {
    if ( isFolder(f) || removedSet.has(f.file) ) continue;
    let id = f.data.folder;
    while ( id && folders.has(id) && !needed.has(id) ) {
      needed.add(id);
      id = folders.get(id).data.folder;
    }
  }
  const emptyFolders = [...folders.values()].filter(f => !needed.has(f.data._id));

  console.log(`${name}: ${files.length - folders.size} documents, removing ${removed.length}`
    + ` (${emptyFolders.length} emptied folders)`);
  if ( !APPLY ) return fs.rm(tmp, { recursive: true, force: true });

  for ( const f of [...removed, ...emptyFolders] ) await fs.rm(f.file);
  const built = path.join(tmp, "built");
  await compilePack(src, built, { log: false });
  await fs.mkdir(path.join(PACKS, "_backup"), { recursive: true });
  await fs.rename(packDir, path.join(PACKS, "_backup", name));
  await fs.rename(built, packDir);
  await fs.rm(tmp, { recursive: true, force: true });
}

for ( const [name, rule] of Object.entries(RULES) ) await filterPack(name, rule);

for ( const name of REMOVE_PACKS ) {
  console.log(`${name}: ${APPLY ? "removing pack folder" : "would remove pack folder"}`);
  if ( !APPLY ) continue;
  await fs.mkdir(path.join(PACKS, "_backup"), { recursive: true });
  await fs.rename(path.join(PACKS, name), path.join(PACKS, "_backup", name)).catch(() => {});
}
if ( !APPLY ) console.log("\nDry run only. Re-run with --apply to write changes.");

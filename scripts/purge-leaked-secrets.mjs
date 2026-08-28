#!/usr/bin/env node
/**
 * Purge secrets leaked in deploy/KLANVIO-DEPLOY.md history.
 * Requires: pip install git-filter-repo
 *
 * Usage (from repo root, after rotating live secrets):
 *   node scripts/purge-leaked-secrets.mjs --dry-run
 *   node scripts/purge-leaked-secrets.mjs --apply
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run") || !apply;

function collectLeakedValues() {
  let log = "";
  try {
    log = execSync("git log --all -p -- deploy/KLANVIO-DEPLOY.md", {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return [];
  }

  const replacements = new Map();
  for (const m of log.matchAll(/EVOLUTION_API_KEY=([A-Za-z0-9]{16,})/g)) {
    replacements.set(m[1], "[ROTATED_EVOLUTION_API_KEY]");
  }
  for (const m of log.matchAll(/postgres\.[a-z0-9]+:([^@\[\s\n]+)@/gi)) {
    const val = m[1];
    if (/^(VOTRE_MOT_DE_PASSE|\[)/i.test(val)) continue;
    if (val.length < 8) continue;
    replacements.set(val, "[ROTATED_SUPABASE_DB_PASSWORD]");
  }
  return [...replacements.entries()];
}

function hasFilterRepo() {
  try {
    execSync("git filter-repo --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const pairs = collectLeakedValues();
const replacementsPath = path.join(root, ".git-filter-repo-replacements.txt");

console.log("Leaked unique values found:", pairs.length);
if (pairs.length === 0) {
  console.log("Nothing to purge in deploy/KLANVIO-DEPLOY.md history.");
  process.exit(0);
}

const lines = pairs.map(([a, b]) => `${a}==>${b}`).join("\n") + "\n";
fs.writeFileSync(replacementsPath, lines, "utf8");
console.log("Replacements file (local, gitignored):", replacementsPath);

if (!hasFilterRepo()) {
  console.error(
    "\ngit-filter-repo not found. Install:\n  pip install git-filter-repo\nThen re-run with --apply\n",
  );
  process.exit(1);
}

if (dryRun) {
  console.log("\nDry run — would execute:");
  console.log(`  git filter-repo --force --replace-text ${replacementsPath}`);
  console.log("\nThen: git push --force origin --all && git push --force origin --tags");
  console.log("⚠️  Rotate Supabase + Evolution secrets BEFORE force push.\n");
  process.exit(0);
}

console.log("\nRewriting history (this may take a minute)...");
const r = spawnSync(
  "git",
  ["filter-repo", "--force", "--replace-text", replacementsPath],
  { cwd: root, stdio: "inherit", shell: true },
);
if (r.status !== 0) process.exit(r.status ?? 1);

console.log("\n✅ History rewritten locally.");
console.log("Next: rotate live secrets, then force-push all branches/tags.");
console.log("All clones must re-clone or hard reset.\n");

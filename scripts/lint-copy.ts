import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describeHit, scanCopy, type CopyHit } from "../src/server/domain/copy-lint";

/**
 * The copy lint. Fails the run when a banned claim reaches UI copy, a code
 * comment, or the README.
 *
 *   npm run lint:copy
 *   npm run lint:copy -- --dist      # also scan prerendered HTML in .next
 *
 * The phrase list lives in `src/server/domain/copy-lint.ts` so the unit test,
 * the app, and this script share one definition. This script is read-only: it
 * prints `file:line:column` for every hit and exits 1, so `npm run lint` can
 * chain it after ESLint.
 */

const REPO_ROOT = resolve(__dirname, "..");
const SOURCE_ROOTS = ["src"];
const EXTRA_FILES = ["README.md"];
const SKIPPABLE = new Set([
  join(REPO_ROOT, "src", "server", "domain", "copy-lint.ts"),
]);

type Hit = CopyHit & { file: string };

function collect(directory: string, extensions: RegExp): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collect(path, extensions));
    } else if (extensions.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function sourceFiles(): string[] {
  const files = SOURCE_ROOTS.flatMap((root) =>
    collect(join(REPO_ROOT, root), /\.(ts|tsx|md)$/),
  );
  for (const name of EXTRA_FILES) {
    const path = join(REPO_ROOT, name);
    try {
      if (statSync(path).isFile()) files.push(path);
    } catch {
      // A file that does not exist yet is not a failure.
    }
  }
  return files.filter((file) => !SKIPPABLE.has(file));
}

function distFiles(): string[] {
  return collect(join(REPO_ROOT, ".next", "server", "app"), /\.html$/);
}

function scan(files: readonly string[]): Hit[] {
  return files.flatMap((file) =>
    scanCopy(readFileSync(file, "utf8")).map((hit) => ({ ...hit, file })),
  );
}

function main(): void {
  const includeDist = process.argv.includes("--dist");
  const files = [...sourceFiles(), ...(includeDist ? distFiles() : [])];
  const hits = scan(files);

  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(describeHit(relative(REPO_ROOT, hit.file), hit));
    }
    console.error(
      `\ncopy lint failed: ${hits.length} banned claim(s) in ${files.length} scanned file(s).`,
    );
    process.exit(1);
  }

  console.log(
    `copy lint: ${files.length} file(s) scanned, no banned claims.`,
  );
}

main();

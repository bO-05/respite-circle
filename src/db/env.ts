import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal `.env` parser for scripts and test setup.
 *
 * Next.js loads `.env.local` for the app runtime, but `tsx scripts/*.ts`,
 * `drizzle.config.ts`, and the Vitest global setup run outside Next and would
 * otherwise see an empty process environment. Real values never enter git:
 * `.env.local` is git-excluded and `.env.example` carries empty placeholders.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, name, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values end at an unescaped `#`, matching dotenv behaviour.
      const comment = value.indexOf(" #");
      if (comment !== -1) value = value.slice(0, comment).trim();
    }

    values[name] = value;
  }

  return values;
}

/**
 * Load `.env.local` (or another file) without overwriting values already set
 * in the process environment. An explicit shell or CI value always wins.
 */
export function loadEnvLocal(
  cwd: string = process.cwd(),
  fileName = ".env.local",
): void {
  const filePath = resolve(cwd, fileName);
  if (!existsSync(filePath)) return;

  for (const [name, value] of Object.entries(
    parseEnvFile(readFileSync(filePath, "utf8")),
  )) {
    if (process.env[name] === undefined || process.env[name] === "") {
      process.env[name] = value;
    }
  }
}

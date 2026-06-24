/**
 * scripts/utils.ts
 *
 * Shared helpers for the build scripts: process-wide dry-run detection, a
 * command runner that keeps the terminal attached (so sudo can prompt for a
 * password), a CLI entrypoint wrapper that reports failures consistently, and
 * locating the built .deb.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pc from 'picocolors';

/** True when invoked with --dry-run or -n: commands are printed, not executed. */
export const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');

/** Run a command with the terminal attached so sudo can prompt for a password. */
export async function run(cmd: string[]): Promise<void> {
  console.log(pc.dim(`$ ${cmd.join(' ')}`));
  if (DRY_RUN) return;

  const proc = Bun.spawn(cmd, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`${cmd.join(' ')}\` exited with code ${code}`);
  }
}

/**
 * Run a script's entrypoint: await `fn`, and on failure print a consistent red
 * error line (prefixed with `label`) and exit non-zero.
 */
export async function cli(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n${pc.red(pc.bold(`✗ ${label} failed`))}${pc.dim(' — ')}${pc.red(message)}`);
    process.exit(1);
  }
}

/** The Handy .deb bundle directory (the tauri build output). */
export const DEB_DIR = join(resolve(import.meta.dir, '..'), 'Handy', 'src-tauri', 'target', 'release', 'bundle', 'deb');

/** The newest .deb in DEB_DIR (the one the latest build produced), if any. */
export function findDeb(): string | undefined {
  if (!existsSync(DEB_DIR)) return undefined;
  const debs = readdirSync(DEB_DIR)
    .filter((f) => f.endsWith('.deb'))
    .map((f) => join(DEB_DIR, f));
  return debs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

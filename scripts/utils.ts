/**
 * scripts/utils.ts
 *
 * Shared helpers for the build scripts: process-wide dry-run detection, a
 * command runner that keeps the terminal attached (so sudo can prompt for a
 * password), and a CLI entrypoint wrapper that reports failures consistently.
 */

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

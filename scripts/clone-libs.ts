#!/usr/bin/env bun

/**
 * scripts/clone-libs.ts
 *
 * Clones the upstream source repositories this project builds against — Handy
 * (the app) and transcribe-rs (its transcription backend) — into the repo root,
 * side by side, where the rest of the build scripts expect them. Handy's
 * `src-tauri/Cargo.toml` references transcribe-rs via the relative path
 * `../../transcribe-rs`, so the two must be siblings here.
 *
 * These repos are intentionally NOT vendored into this repository (see
 * .gitignore) — this script reproduces the `git clone` step so a fresh checkout
 * can be bootstrapped on any machine. It is safe to re-run: a library that is
 * already cloned is left untouched.
 *
 * Usage:
 *   bun run scripts/clone-libs.ts
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { $ } from 'bun';
import pc from 'picocolors';

interface Lib {
  /** Directory name created in the repo root. Must match the path the build expects. */
  name: string;
  /** Git URL to clone from. */
  url: string;
  /**
   * Optional commit / tag / branch to check out after cloning, for reproducible
   * builds. Left unset => clone the latest default branch (shallow).
   *
   * The commits this CUDA build was last validated against:
   *   Handy         a92a4d5
   *   transcribe-rs d97ae65
   * Set `ref` to one of these if upstream drift ever breaks the patch scripts.
   */
  ref?: string;
}

const LIBS: Lib[] = [
  { name: 'Handy', url: 'https://github.com/cjpais/Handy.git' },
  { name: 'transcribe-rs', url: 'https://github.com/cjpais/transcribe-rs.git' },
];

/** Repo root is the parent of this scripts/ directory, regardless of cwd. */
const ROOT = resolve(import.meta.dir, '..');

type CloneOutcome = 'cloned' | 'skipped';

async function cloneLib(lib: Lib): Promise<CloneOutcome> {
  const dest = join(ROOT, lib.name);

  // Already a git checkout — leave it alone (re-run safe, preserves local edits).
  if (existsSync(join(dest, '.git'))) {
    console.log(
      `${pc.yellow('•')} ${pc.bold(lib.name)} ${pc.dim('already present — skipping')}`,
    );
    return 'skipped';
  }

  // Path exists but isn't a git repo: refuse to clobber it; let the user decide.
  if (existsSync(dest)) {
    throw new Error(
      `${lib.name}/ exists but is not a git repository. Remove or move it, then re-run.`,
    );
  }

  console.log(
    `${pc.cyan('↓')} Cloning ${pc.bold(lib.name)} ${pc.dim(`from ${lib.url}`)} …`,
  );
  if (lib.ref) {
    await $`git clone ${lib.url} ${dest}`;
    await $`git -C ${dest} checkout ${lib.ref}`;
    console.log(
      `${pc.green('✓')} ${pc.bold(lib.name)} ${pc.dim(`cloned @ ${lib.ref}`)}`,
    );
  } else {
    // Shallow clone — we only need the working tree to build from.
    await $`git clone --depth 1 ${lib.url} ${dest}`;
    console.log(
      `${pc.green('✓')} ${pc.bold(lib.name)} ${pc.dim('cloned (latest)')}`,
    );
  }
  return 'cloned';
}

export async function cloneLibs(): Promise<void> {
  console.log(
    pc.bold(pc.cyan('\nCloning source libraries')) + pc.dim(` into ${ROOT}\n`),
  );

  let cloned = 0;
  let skipped = 0;
  for (const lib of LIBS) {
    if ((await cloneLib(lib)) === 'cloned') cloned++;
    else skipped++;
  }

  console.log(
    '\n' +
      pc.green(pc.bold('Done')) +
      pc.dim(' — ') +
      pc.green(`${cloned} cloned`) +
      pc.dim(', ') +
      pc.yellow(`${skipped} already present`) +
      pc.dim('.'),
  );
}

if (import.meta.main) {
  cloneLibs().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      '\n' +
        pc.red(pc.bold('✗ clone-libs failed')) +
        pc.dim(' — ') +
        pc.red(message),
    );
    process.exit(1);
  });
}

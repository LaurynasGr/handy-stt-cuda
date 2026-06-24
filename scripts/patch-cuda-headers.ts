#!/usr/bin/env bun
/**
 * scripts/patch-cuda-headers.ts
 *
 * Patches CUDA's crt/math_functions.h so it compiles against a modern glibc.
 *
 * glibc 2.41+ declares rsqrt/rsqrtf with noexcept(true); CUDA <= 13.1 declares
 * the same functions without it, so nvcc's host pass fails with "exception
 * specification is incompatible" while building whisper.cpp's CUDA backend. The
 * fix — matching what CUDA already does for sqrt — adds noexcept(true) to the
 * four rsqrt/rsqrtf declarations.
 *
 * This edits a root-owned system header, so it uses sudo (you will be prompted)
 * and keeps a pristine .orig backup. Idempotent: an already-patched header is
 * detected and left untouched.
 *
 * Usage:
 *   bun run scripts/patch-cuda-headers.ts
 *   bun run scripts/patch-cuda-headers.ts --dry-run
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { cli, DRY_RUN, run } from './utils';

/** CUDA install to patch — honor CUDA_PATH, else the /usr/local/cuda symlink. */
const CUDA_PATH = process.env.CUDA_PATH ?? '/usr/local/cuda';
const HEADER = join(CUDA_PATH, 'targets/x86_64-linux/include/crt/math_functions.h');

/**
 * The four rsqrt/rsqrtf declarations to fix. Each `from` is matched literally
 * and rewritten to `to`, inserting noexcept(true) before the trailing `;` (or,
 * for the __func__(...) wrapper forms, before its closing paren).
 */
const PATCHES = [
  { from: 'rsqrt(double x);', to: 'rsqrt(double x) noexcept(true);' },
  { from: 'rsqrtf(float x);', to: 'rsqrtf(float x) noexcept(true);' },
  { from: 'rsqrt(double a));', to: 'rsqrt(double a) noexcept(true));' },
  { from: 'rsqrtf(float a));', to: 'rsqrtf(float a) noexcept(true));' },
];

export async function patchCudaHeaders(): Promise<void> {
  console.log(pc.bold(pc.cyan('\nPatching CUDA math_functions.h for glibc')) + pc.dim(`\n${HEADER}\n`));

  if (!existsSync(HEADER)) {
    throw new Error(`Header not found: ${HEADER}\nIs the CUDA toolkit installed? Set CUDA_PATH to override.`);
  }

  const original = await Bun.file(HEADER).text();

  // Decide, per declaration, whether it needs the fix, already has it, or is
  // missing entirely (a CUDA version whose header we don't recognise).
  let patched = original;
  const applied: string[] = [];
  const already: string[] = [];
  const missing: string[] = [];
  for (const { from, to } of PATCHES) {
    if (patched.includes(to)) {
      already.push(from);
    } else if (patched.includes(from)) {
      patched = patched.replaceAll(from, to);
      applied.push(from);
    } else {
      missing.push(from);
    }
  }

  for (const f of already) {
    console.log(`${pc.yellow('•')} ${pc.dim(`${f}  already patched`)}`);
  }
  for (const f of applied) {
    console.log(`${pc.cyan('→')} ${pc.dim(`${f}  +noexcept(true)`)}`);
  }
  for (const f of missing) {
    console.log(`${pc.red('?')} ${pc.dim(`${f}  not found`)}`);
  }

  if (applied.length === 0) {
    if (already.length === PATCHES.length) {
      console.log(`\n${pc.green(pc.bold('✓ Already patched'))}${pc.dim(' — nothing to do.')}`);
      return;
    }
    throw new Error(
      'No rsqrt/rsqrtf declarations matched — likely a different CUDA version than expected. Header left untouched.',
    );
  }

  const backup = `${HEADER}.orig`;
  const needsBackup = !existsSync(backup);

  if (DRY_RUN) {
    console.log(pc.yellow('\n(dry run — nothing will be written)'));
    if (needsBackup) {
      console.log(pc.dim(`would back up  ${HEADER} → ${backup}`));
    }
    console.log(pc.dim(`would write    ${applied.length} fix(es) to ${HEADER}`));
    console.log(
      `\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim(` — ${applied.length} declaration(s) would be patched.`)}`,
    );
    return;
  }

  // Back up the pristine header once (never overwrite an existing .orig).
  if (needsBackup) {
    await run(['sudo', 'cp', HEADER, backup]);
    console.log(pc.dim(`backed up → ${backup}`));
  } else {
    console.log(pc.dim(`pristine backup already exists → ${backup}`));
  }

  // Write the patched content via a temp file we own, then sudo-copy it over the
  // root-owned header (cp preserves the destination's ownership and mode).
  const tmp = join(process.env.TMPDIR ?? '/tmp', 'handy-math_functions.h');
  await Bun.write(tmp, patched);
  await run(['sudo', 'cp', tmp, HEADER]);
  rmSync(tmp, { force: true });

  // Verify the on-disk header now reflects every fix we applied.
  const result = await Bun.file(HEADER).text();
  const failed = applied.filter((from) => result.includes(from));
  if (failed.length > 0) {
    throw new Error(`Patch verification failed — still unpatched: ${failed.join(', ')}`);
  }

  console.log(
    `\n${pc.green(pc.bold('✓ CUDA headers patched'))}${pc.dim(` — ${applied.length} declaration(s) updated.`)}`,
  );
}

if (import.meta.main) {
  await cli('patch-cuda-headers', patchCudaHeaders);
}

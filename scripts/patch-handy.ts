#!/usr/bin/env bun
/**
 * scripts/patch-handy.ts
 *
 * Patches the cloned Handy source so it builds against the local, CUDA-enabled
 * transcribe-rs. In Handy/src-tauri/Cargo.toml it:
 *   - points every `transcribe-rs` dependency at the local ../../transcribe-rs
 *     checkout (cargo requires one canonical source across all target blocks),
 *   - switches the Linux target's whisper backend from `whisper-vulkan` to
 *     `whisper-cuda`.
 *
 * Runs against the cloned Handy working tree (clone-libs first). Idempotent and
 * supports --dry-run. It deliberately does NOT touch Cargo.lock — cargo
 * regenerates that from the manifest on the next build. The app version is
 * tagged (+cuda.<timestamp>) by build.ts, not here.
 *
 * Usage:
 *   bun run scripts/patch-handy.ts
 *   bun run scripts/patch-handy.ts --dry-run
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pc from 'picocolors';
import { cli, DRY_RUN } from './utils';

const ROOT = resolve(import.meta.dir, '..');
const SRC_TAURI = join(ROOT, 'Handy', 'src-tauri');
const CARGO_TOML = join(SRC_TAURI, 'Cargo.toml');

/** One named text transform on a file's contents. */
interface Edit {
  label: string;
  apply: (content: string) => string;
}

const CARGO_EDITS: Edit[] = [
  {
    label: 'point every transcribe-rs dependency at ../../transcribe-rs',
    // Version-agnostic: rewrites the source of all four target-block deps.
    apply: (c) =>
      c.replaceAll(/transcribe-rs = \{ version = "[^"]*"/g, 'transcribe-rs = { path = "../../transcribe-rs"'),
  },
  {
    label: 'switch the Linux whisper backend from vulkan to cuda',
    // Only the Linux block has the bare ["whisper-vulkan"]; Windows keeps its
    // ["whisper-vulkan", "ort-directml"] (different string, left untouched).
    apply: (c) => c.replaceAll('["whisper-vulkan"]', '["whisper-cuda"]'),
  },
];

/** Apply edits to a file, log each, verify the end state, write if changed. */
async function patchFile(path: string, edits: Edit[], verify: (content: string) => string | null): Promise<boolean> {
  if (!existsSync(path)) {
    throw new Error(`Not found: ${path}\nRun clone-libs first.`);
  }

  const original = await Bun.file(path).text();
  let content = original;
  for (const edit of edits) {
    const next = edit.apply(content);
    const changed = next !== content;
    const suffix = changed ? '' : pc.dim(' (no change)');
    console.log(`  ${changed ? pc.cyan('→') : pc.dim('·')} ${edit.label}${suffix}`);
    content = next;
  }

  const problem = verify(content);
  if (problem) {
    throw new Error(`${path}\n  ${problem}`);
  }

  if (content === original) return false;
  if (!DRY_RUN) await Bun.write(path, content);
  return true;
}

export async function patchHandy(): Promise<void> {
  console.log(pc.bold(pc.cyan('\nPatching Handy source for CUDA')));
  if (DRY_RUN) console.log(pc.yellow('(dry run — no files will be written)'));

  console.log(pc.bold(`\n${CARGO_TOML}`));
  const changed = await patchFile(CARGO_TOML, CARGO_EDITS, (c) => {
    if (/transcribe-rs = \{ version = "/.test(c)) {
      return 'a transcribe-rs dependency still points at the registry';
    }
    if (!c.includes('transcribe-rs = { path = "../../transcribe-rs"')) {
      return 'no local transcribe-rs path dependency found';
    }
    if (!c.includes('["whisper-cuda"]')) {
      return 'the Linux whisper-cuda feature was not set';
    }
    return null;
  });

  if (DRY_RUN) {
    console.log(`\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim('.')}`);
    return;
  }

  if (changed) {
    console.log(`\n${pc.green(pc.bold('✓ Handy Cargo.toml patched'))}${pc.dim('.')}`);
  } else {
    console.log(`\n${pc.green(pc.bold('✓ Already patched'))}${pc.dim(' — nothing to do.')}`);
  }
}

if (import.meta.main) {
  await cli('patch-handy', patchHandy);
}

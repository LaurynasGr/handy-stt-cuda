#!/usr/bin/env bun
/**
 * scripts/patch-handy.ts
 *
 * Patches the cloned Handy source so it builds against the local, CUDA-enabled
 * transcribe-rs:
 *
 *   Handy/src-tauri/Cargo.toml
 *     - point every `transcribe-rs` dependency at the local ../../transcribe-rs
 *       checkout (cargo requires one canonical source across all target blocks),
 *     - switch the Linux target's whisper backend from `whisper-vulkan` to
 *       `whisper-cuda`.
 *
 *   Handy/src-tauri/tauri.conf.json
 *     - tag the app version with `+cuda` so the installed build is identifiable
 *       (build metadata = equal precedence, so the updater won't replace it).
 *
 * Runs against the cloned Handy working tree (clone-libs first). Idempotent and
 * supports --dry-run. It deliberately does NOT touch Cargo.lock — cargo
 * regenerates that from these manifests on the next build.
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
const TAURI_CONF = join(SRC_TAURI, 'tauri.conf.json');

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

const TAURI_EDITS: Edit[] = [
  {
    label: 'tag the app version with +cuda',
    // First "version": "x.y.z" is the top-level app version. The pattern can't
    // match an already-tagged "x.y.z+cuda", so this is idempotent.
    apply: (c) => c.replace(/"version": "(\d+\.\d+\.\d+)"/, '"version": "$1+cuda"'),
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
  const cargoChanged = await patchFile(CARGO_TOML, CARGO_EDITS, (c) => {
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

  console.log(pc.bold(`\n${TAURI_CONF}`));
  const confChanged = await patchFile(TAURI_CONF, TAURI_EDITS, (c) =>
    /"version": "\d+\.\d+\.\d+\+cuda"/.test(c) ? null : 'the app version is not tagged with +cuda',
  );

  if (DRY_RUN) {
    console.log(`\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim('.')}`);
    return;
  }

  const updated = (cargoChanged ? 1 : 0) + (confChanged ? 1 : 0);
  if (updated === 0) {
    console.log(`\n${pc.green(pc.bold('✓ Already patched'))}${pc.dim(' — nothing to do.')}`);
  } else {
    console.log(`\n${pc.green(pc.bold('✓ Handy source patched'))}${pc.dim(` — ${updated} file(s) updated.`)}`);
  }
}

if (import.meta.main) {
  await cli('patch-handy', patchHandy);
}

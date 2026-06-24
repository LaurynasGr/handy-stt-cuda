#!/usr/bin/env bun
/**
 * scripts/build.ts
 *
 * Builds Handy from the cloned, patched source with the CUDA Whisper backend
 * and produces a .deb. Sets up the CUDA build environment (host compiler,
 * target arch, nvcc + cargo on PATH, libclang for bindgen) and runs the Tauri
 * release build.
 *
 * Run the prerequisites first (in order):
 *   make clone-libs && make setup-deps && make patch-cuda-headers && make patch-handy
 * and have the CUDA toolkit + NVIDIA driver installed. Defaults are the values
 * validated on Ubuntu 26.04 / CUDA 13.1 / gcc-14; every one can be overridden
 * via the matching environment variable.
 *
 * Usage:
 *   bun run scripts/build.ts
 *   bun run scripts/build.ts --dry-run   # print the env + command, build nothing
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import pc from 'picocolors';
import { cli, DEB_DIR, DRY_RUN, findDeb } from './utils';

const ROOT = resolve(import.meta.dir, '..');
const HANDY = join(ROOT, 'Handy');
const SRC_TAURI = join(HANDY, 'src-tauri');
const CUDA_PATH = process.env.CUDA_PATH ?? '/usr/local/cuda';

/** GPU compute capability for CUDAARCHS — auto-detect (RTX 4090 = 89), else fall back. */
function cudaArch(): string {
  if (process.env.CUDAARCHS) return process.env.CUDAARCHS;
  try {
    const p = Bun.spawnSync(['nvidia-smi', '--query-gpu=compute_cap', '--format=csv,noheader']);
    const cap = p.stdout.toString().trim().split('\n')[0]?.trim();
    if (cap && /^\d+\.\d+$/.test(cap)) return cap.replace('.', '');
  } catch {
    // nvidia-smi unavailable — fall back to the default below.
  }
  return '89';
}

/** The CUDA build environment, validated on Ubuntu 26.04 / CUDA 13.1 / gcc-14. */
function buildEnv(): Record<string, string | undefined> {
  const path = [join(CUDA_PATH, 'bin'), join(homedir(), '.cargo', 'bin'), process.env.PATH ?? ''].join(':');

  return {
    ...process.env,
    PATH: path,
    CUDA_PATH,
    CUDAARCHS: cudaArch(),
    CUDAHOSTCXX: process.env.CUDAHOSTCXX ?? '/usr/bin/g++-14',
    CUDAFLAGS: process.env.CUDAFLAGS ?? '-allow-unsupported-compiler',
    CMAKE_GENERATOR: process.env.CMAKE_GENERATOR ?? 'Ninja',
    LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? '/usr/lib/llvm-21/lib',
  };
}

/** Fail fast (with a "run make X" hint) if a prerequisite step was skipped. */
async function preflight(): Promise<void> {
  if (!existsSync(join(HANDY, 'package.json'))) {
    throw new Error(`Handy not found at ${HANDY}\n  Run: make clone-libs`);
  }
  const cargo = await Bun.file(join(SRC_TAURI, 'Cargo.toml')).text();
  if (!cargo.includes('transcribe-rs = { path = "../../transcribe-rs"')) {
    throw new Error('Handy Cargo.toml is not CUDA-patched\n  Run: make patch-handy');
  }
  const header = join(CUDA_PATH, 'targets/x86_64-linux/include/crt/math_functions.h');
  if (existsSync(header)) {
    const h = await Bun.file(header).text();
    if (!h.includes('rsqrt(double x) noexcept(true);')) {
      throw new Error('CUDA math_functions.h is not glibc-patched\n  Run: make patch-cuda-headers');
    }
  }
}

/**
 * Re-stamp tauri.conf.json's version with a fresh +cuda.<timestamp> so every
 * build shows a distinct version. It is semver build metadata, so it has no
 * effect on the updater's version precedence. Handles a bare "x.y.z" as well as
 * a previously-stamped "x.y.z+cuda...".
 */
async function stampVersion(): Promise<string> {
  const file = join(SRC_TAURI, 'tauri.conf.json');
  const content = await Bun.file(file).text();
  const next = content.replace(/"version": "(\d+\.\d+\.\d+)(?:\+cuda[^"]*)?"/, `"version": "$1+cuda.${Date.now()}"`);
  if (!DRY_RUN) await Bun.write(file, next);
  return next.match(/"version": "([^"]*)"/)?.[1] ?? '';
}

export async function build(): Promise<void> {
  console.log(pc.bold(pc.cyan('\nBuilding Handy with the CUDA Whisper backend')));

  await preflight();

  const version = await stampVersion();
  console.log(pc.dim(`version: ${version}`));

  const env = buildEnv();
  console.log(
    pc.dim(`\nCUDAARCHS=${env.CUDAARCHS}  CUDAHOSTCXX=${env.CUDAHOSTCXX}  CMAKE_GENERATOR=${env.CMAKE_GENERATOR}`),
  );

  const cmd = ['bun', 'run', 'tauri', 'build', '--bundles', 'deb'];
  console.log(pc.dim(`$ ${cmd.join(' ')}`));
  if (DRY_RUN) {
    console.log(`\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim(' — nothing was built.')}`);
    return;
  }

  // tauri exits non-zero on the updater-signing step *after* bundling the .deb,
  // so success is judged by whether the .deb was produced, not the exit code.
  const proc = Bun.spawn(cmd, {
    cwd: HANDY,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;

  const deb = findDeb();
  if (!deb) {
    throw new Error(`Build failed (tauri exited ${code}) — no .deb in ${DEB_DIR}`);
  }
  if (code !== 0) {
    console.log(
      pc.yellow(
        `\nnote: tauri exited ${code} — expected (the updater-signing step has no private key); the .deb built fine.`,
      ),
    );
  }
  console.log(`\n${pc.green(pc.bold('✓ Build complete'))}${pc.dim(' — ')}${deb}`);
}

if (import.meta.main) {
  await cli('build', build);
}

#!/usr/bin/env bun
/**
 * scripts/setup-deps.ts
 *
 * Installs the system packages required to build Handy with the CUDA Whisper
 * backend on Ubuntu/Debian, via `sudo apt-get install` (you will be prompted
 * for your password). apt-get is idempotent, so this is safe to re-run.
 *
 * It does NOT install the CUDA toolkit or the NVIDIA driver — those must
 * already be present; this only covers the apt-installable build dependencies.
 *
 * Usage:
 *   bun run scripts/setup-deps.ts            # install
 *   bun run scripts/setup-deps.ts --dry-run  # print the commands, install nothing
 */

import pc from 'picocolors';

/**
 * The apt packages the CUDA build needs, grouped by why. This is the exact set
 * the build was validated against on Ubuntu 26.04 (gcc-15 / glibc 2.43 / CUDA
 * 13.1).
 */
const APT_PACKAGES = [
  // Tauri app + GTK/WebKit runtime and build deps (from Handy's BUILD.md)
  'build-essential',
  'pkg-config',
  'libssl-dev',
  'libasound2-dev', // ALSA — cpal audio capture
  'libgtk-3-dev',
  'libwebkit2gtk-4.1-dev', // Tauri webview
  'libayatana-appindicator3-dev', // tray icon
  'librsvg2-dev',
  'libgtk-layer-shell0',
  'libgtk-layer-shell-dev', // recording overlay
  'patchelf', // bundle rpath fixups
  // Native toolchain for whisper.cpp's CUDA backend
  'cmake',
  'ninja-build',
  'g++-14', // CUDA 13.x host compiler — the system gcc-15 is unsupported by nvcc
  // System libs surfaced by the Rust dependency graph during the build
  'libevdev-dev', // evdev-sys, pulled in by rdev (global shortcuts)
  'libclang-common-21-dev', // clang headers (stdbool.h) for whisper-rs-sys bindgen
];

const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');

/** Run a command with the terminal attached so sudo can prompt for a password. */
async function run(cmd: string[]): Promise<void> {
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

export async function setupDeps(): Promise<void> {
  if (process.platform !== 'linux' || !Bun.which('apt-get')) {
    throw new Error('setup-deps targets Debian/Ubuntu (apt-get not found). See the Handy BUILD.md for other distros.');
  }

  console.log(pc.bold(pc.cyan('\nInstalling build dependencies')) + pc.dim(` — ${APT_PACKAGES.length} apt packages`));
  if (DRY_RUN) {
    console.log(pc.yellow('(dry run — nothing will be installed)'));
  }
  console.log(pc.dim('\nsudo is required; you may be prompted for your password.\n'));

  await run(['sudo', 'apt-get', 'update']);
  await run(['sudo', 'apt-get', 'install', '-y', ...APT_PACKAGES]);

  if (DRY_RUN) {
    console.log(`\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim(' — nothing was installed.')}`);
    return;
  }

  console.log(
    '\n' +
      pc.green(pc.bold('✓ Build dependencies installed.')) +
      pc.dim('\nThe CUDA toolkit and NVIDIA driver are not managed here and must already be present.'),
  );
}

if (import.meta.main) {
  setupDeps().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n${pc.red(pc.bold('✗ setup-deps failed'))}${pc.dim(' — ')}${pc.red(message)}`);
    process.exit(1);
  });
}

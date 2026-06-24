#!/usr/bin/env bun
/**
 * scripts/install.ts
 *
 * Installs the freshly-built Handy .deb: quits any running instance (so the
 * binary isn't in use), installs the newest .deb, then relaunches Handy
 * detached so the new build is running when this finishes.
 *
 * Run `make build` first. Uses sudo — you'll be prompted for your password.
 *
 * Usage:
 *   bun run scripts/install.ts
 *   bun run scripts/install.ts --dry-run
 */

import pc from 'picocolors';
import { cli, DEB_DIR, DRY_RUN, findDeb, run } from './utils';

export async function install(): Promise<void> {
  console.log(pc.bold(pc.cyan('\nInstalling the Handy CUDA build')));

  const deb = findDeb();
  if (!deb) {
    throw new Error(`No .deb found in ${DEB_DIR}\n  Run: make build`);
  }
  console.log(pc.dim(`deb: ${deb}`));

  // Quit any running instance so the new binary isn't in use. pkill exits
  // non-zero when nothing matched — expected, so it doesn't go through run().
  console.log(pc.dim('$ pkill -x handy'));
  if (!DRY_RUN) Bun.spawnSync(['pkill', '-x', 'handy']);

  // Each build's version is timestamped (strictly newer), so dpkg -i is always
  // a clean upgrade — no same-version reinstall prompt.
  await run(['sudo', 'dpkg', '-i', deb]);

  // Relaunch detached so Handy keeps running after this script exits.
  console.log(pc.dim('$ setsid handy'));
  if (!DRY_RUN) {
    Bun.spawn(['setsid', 'handy'], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }).unref();
  }

  if (DRY_RUN) {
    console.log(`\n${pc.yellow(pc.bold('Dry run complete'))}${pc.dim(' — nothing was installed.')}`);
    return;
  }
  console.log(`\n${pc.green(pc.bold('✓ Installed and relaunched'))}${pc.dim('.')}`);
}

if (import.meta.main) {
  await cli('install', install);
}

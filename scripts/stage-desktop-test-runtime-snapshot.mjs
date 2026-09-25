#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { stageDesktopTestRuntimeSnapshot } from './lib/desktop-test-assistance-runtime-snapshots.mjs';

const root = resolve(import.meta.dirname, '..');
const targetId = `${process.env.SOUNDSCAPER_DESKTOP_TARGET_PLATFORM}-${process.env.SOUNDSCAPER_DESKTOP_TARGET_ARCH}`;
const lock = JSON.parse(await readFile(resolve(root, 'config/desktop-test-assistance-runtime-snapshots.json'), 'utf8'));
const staged = await stageDesktopTestRuntimeSnapshot({
	targetId,
	lock,
	snapshotRoot: resolve(root, 'config/desktop-test-assistance-runtime-snapshots'),
	outputRoot: resolve(root, '.native-build/assistance-runtime-handoff'),
});
if (process.env.GITHUB_ENV) {
	await appendFile(process.env.GITHUB_ENV,
		`SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT=true\n`
		+ `SOUNDSCAPER_TEST_RUNTIME_SNAPSHOT_SOURCE_REVISION=${staged.sourceRevision}\n`);
}
console.log(`Staged pinned ${targetId} runtime handoff from ${staged.sourceRevision}.`);

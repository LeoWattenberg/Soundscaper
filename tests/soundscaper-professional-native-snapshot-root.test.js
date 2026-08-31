/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperProfessionalNativeSnapshotRoot,
} from '../scripts/lib/soundscaper-professional-native-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('the build planner creates a missing private snapshot parent but claims its leaf exclusively', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-pro-plan-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	const snapshotRoot = join(temporary, '.native-build', 'linux-x64-source-snapshots');

	assert.equal(createSoundscaperProfessionalNativeSnapshotRoot(snapshotRoot), resolve(snapshotRoot));
	assert.deepEqual(await readdir(join(temporary, '.native-build')), ['linux-x64-source-snapshots']);
	assert.throws(
		() => createSoundscaperProfessionalNativeSnapshotRoot(snapshotRoot),
		/EEXIST|already exists/iu,
	);
	assert.match(await readFile(join(ROOT, '.gitignore'), 'utf8'), /^\.native-build\/$/mu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	writeSyncedSoundscaperProfessionalNativeManifest,
} from '../scripts/lib/soundscaper-professional-native-build-result.mjs';

test('native manifest staging flushes and preserves the exact exclusive publication bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-native-manifest-sync-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'manifest.json');
	const bytes = Buffer.from('{\n\t"status": "built", "name": "Größe"\n}\n');
	await writeSyncedSoundscaperProfessionalNativeManifest(path, bytes);
	assert.deepEqual(await readFile(path), bytes);
	await assert.rejects(writeSyncedSoundscaperProfessionalNativeManifest(path, Buffer.from('replacement')), {
		code: 'EEXIST',
	});
	assert.deepEqual(await readFile(path), bytes);
});

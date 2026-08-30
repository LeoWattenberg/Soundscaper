/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	SoundscaperDesktopProjectLibraryFileRangeReader,
	verifySoundscaperDesktopProjectLibraryFile,
} from '../desktop/soundscaper-project-library-publication-files.ts';

test('Soundscaper library range reads authenticate each immutable file identity once', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-ranges-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'media'));
	const path = join(root, 'media', 'body.scaf');
	const displaced = join(root, 'media', 'displaced.scaf');
	const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	await writeFile(path, bytes);
	let authentications = 0;
	const reader = new SoundscaperDesktopProjectLibraryFileRangeReader(async (...args) => {
		authentications += 1;
		return verifySoundscaperDesktopProjectLibraryFile(...args);
	});

	assert.deepEqual(await reader.read(root, 'media/body.scaf', bytes.byteLength, sha256, 0, 3), bytes.slice(0, 3));
	assert.deepEqual(await reader.read(root, 'media/body.scaf', bytes.byteLength, sha256, 3, 3), bytes.slice(3));
	assert.equal(authentications, 1);

	await rename(path, displaced);
	await writeFile(path, Uint8Array.of(6, 5, 4, 3, 2, 1));
	await assert.rejects(
		reader.read(root, 'media/body.scaf', bytes.byteLength, sha256, 0, 3),
		/SHA-256 snapshot verification/iu,
	);
	assert.equal(authentications, 2);
});

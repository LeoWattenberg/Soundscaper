/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	NativeImageSequenceVerifiedBodyReader,
} from '../desktop/native-image-sequence-body-reader.ts';
import { digestImageSequencePath } from '../desktop/native-image-sequence-import-storage.ts';

test('verified body reader authenticates an unchanged asset only once across range reads', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'image-sequence-body-reader-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, 'body.pack');
	const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
	await writeFile(path, bytes);
	let authentications = 0;
	const reader = new NativeImageSequenceVerifiedBodyReader(async (value) => {
		authentications += 1;
		return digestImageSequencePath(value);
	});
	const sha256 = createHash('sha256').update(bytes).digest('hex');

	assert.deepEqual(await reader.read(path, sha256, 0, 3, 4), bytes.slice(0, 3));
	assert.deepEqual(await reader.read(path, sha256, 3, 3, 4), bytes.slice(3));
	assert.equal(authentications, 1);

	await writeFile(path, Uint8Array.of(6, 5, 4, 3, 2, 1));
	await assert.rejects(reader.read(path, sha256, 0, 3, 4), /changed after publication/iu);
	assert.equal(authentications, 2, 'a changed filesystem identity invalidates authentication');
});

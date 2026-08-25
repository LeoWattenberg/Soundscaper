/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { readBundledCodecSourceInput } from '../scripts/lib/bundled-codec-source-input.mjs';

test('codec rebuilds prefer a bounded exact local corresponding-source input', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-codec-source-input-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	await writeFile(join(root, 'codec.tar.xz'), 'exact-source');
	let remoteCalls = 0;
	const bytes = await readBundledCodecSourceInput({
		archiveDirectory: root,
		fileName: 'codec.tar.xz',
		maximumBytes: 64,
		readRemote: async () => {
			remoteCalls += 1;
			return Buffer.from('remote-source');
		},
	});
	assert.equal(String(bytes), 'exact-source');
	assert.equal(remoteCalls, 0);
});

test('codec source input falls back to the pinned upstream acquisition only when no bundle is selected', async () => {
	const bytes = await readBundledCodecSourceInput({
		archiveDirectory: '',
		fileName: 'codec.tar.xz',
		maximumBytes: 64,
		readRemote: async () => Buffer.from('remote-source'),
	});
	assert.equal(String(bytes), 'remote-source');
});

test('codec source input refuses links, traversal, and over-budget local files', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-codec-source-input-invalid-'));
	context.after(() => rm(root, { force: true, recursive: true }));
	const victim = join(root, 'victim');
	await writeFile(victim, 'victim');
	await symlink(victim, join(root, 'linked.tar.xz'));
	for (const options of [
		{ archiveDirectory: root, fileName: '../victim', maximumBytes: 64 },
		{ archiveDirectory: root, fileName: 'linked.tar.xz', maximumBytes: 64 },
		{ archiveDirectory: root, fileName: 'victim', maximumBytes: 2 },
	]) {
		await assert.rejects(
			readBundledCodecSourceInput({ ...options, readRemote: async () => Buffer.from('remote') }),
			/invalid|regular file|exceeds/iu,
		);
	}
});

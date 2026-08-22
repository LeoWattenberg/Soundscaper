/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	acquireNativeMediaDirectoryLease,
	acquireNativeMediaFileLease,
	removeNativeMediaLeasedDirectory,
	removeNativeMediaLeasedFile,
} from '../desktop/native-media-filesystem-lease.ts';

test('leased output cleanup refuses to unlink a replacement identity', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-output-lease-'));
	try {
		const path = join(root, '.output.tmp');
		const displaced = join(root, '.output.displaced');
		await writeFile(path, 'host output');
		const lease = await acquireNativeMediaFileLease({ path, maximumBytes: 1_024 });
		await rename(path, displaced);
		await writeFile(path, 'replacement output');
		await assert.rejects(
			removeNativeMediaLeasedFile(lease),
			/authenticated identity, length, or digest/u,
		);
		assert.equal(String(await readFile(path)), 'replacement output');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('leased reservation cleanup refuses to remove a replacement directory identity', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-directory-lease-'));
	try {
		const path = join(root, 'reservation');
		const displaced = join(root, 'reservation-displaced');
		await mkdir(path);
		const lease = await acquireNativeMediaDirectoryLease({ path });
		await rename(path, displaced);
		await mkdir(path);
		await writeFile(join(path, 'belongs-to-replacement'), 'keep');
		await assert.rejects(
			removeNativeMediaLeasedDirectory(lease),
			/directory no longer matches its granted identity/u,
		);
		assert.equal((await stat(path)).isDirectory(), true);
		assert.equal(String(await readFile(join(path, 'belongs-to-replacement'))), 'keep');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

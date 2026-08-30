/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { claimPathExclusively, renameIntoPlaceExclusively } from '../scripts/lib/exclusive-rename.mjs';

function scratchRoot(context) {
	const root = mkdtempSync(join(tmpdir(), 'exclusive-rename-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

test('claiming a file refuses a destination that appeared after the absence check', async (context) => {
	const root = scratchRoot(context);
	const staged = join(root, 'staged.bin');
	const destination = join(root, 'published.bin');
	await writeFile(staged, 'staged bytes');
	await writeFile(destination, 'already published bytes');

	await assert.rejects(
		() => claimPathExclusively(staged, destination, 'runtime output'),
		/runtime output already exists/u,
	);
	assert.equal(await readFile(destination, 'utf8'), 'already published bytes');
});

test('claiming a file publishes it when the destination is free', async (context) => {
	const root = scratchRoot(context);
	const staged = join(root, 'staged.bin');
	const destination = join(root, 'published.bin');
	await writeFile(staged, 'staged bytes');

	await claimPathExclusively(staged, destination, 'runtime output');
	assert.equal(await readFile(destination, 'utf8'), 'staged bytes');
});

test('claiming a directory refuses a destination that already holds a publication', async (context) => {
	const root = scratchRoot(context);
	const staged = join(root, 'staged');
	const destination = join(root, 'published');
	await mkdir(staged);
	await writeFile(join(staged, 'runtime.bin'), 'staged bytes');
	await mkdir(destination);
	await writeFile(join(destination, 'runtime.bin'), 'already published bytes');

	await assert.rejects(() => claimPathExclusively(staged, destination, 'runtime output'));
	assert.equal(await readFile(join(destination, 'runtime.bin'), 'utf8'), 'already published bytes');
});

test('claiming a directory refuses an empty destination claimed concurrently', async (context) => {
	const root = scratchRoot(context);
	const staged = join(root, 'staged');
	const destination = join(root, 'published');
	await mkdir(staged);
	await writeFile(join(staged, 'runtime.bin'), 'staged bytes');
	await mkdir(destination);

	await assert.rejects(
		() => claimPathExclusively(staged, destination, 'runtime output'),
		/runtime output already exists/u,
	);
	assert.deepEqual(await readFile(join(staged, 'runtime.bin'), 'utf8'), 'staged bytes');
});

test('a published file is never replaced by a later staging of the same destination', async (context) => {
	const root = scratchRoot(context);
	const destination = join(root, 'runtime', 'notice.txt');
	const publish = (bytes) => renameIntoPlaceExclusively(destination, 'notice output', async (temporary) => {
		const staged = join(temporary, 'notice.txt');
		await writeFile(staged, bytes, { flag: 'wx' });
		return staged;
	});

	await publish('first publication');
	await assert.rejects(() => publish('second publication'), /notice output already exists/u);
	assert.equal(await readFile(destination, 'utf8'), 'first publication');
});

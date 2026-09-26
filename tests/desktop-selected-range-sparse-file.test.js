/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

test('desktop reads the tail of a real sparse 7 GiB Audacity selection through its pinned handle', {
	skip: process.platform !== 'linux' ? 'The sparse 7 GiB fixture uses Linux filesystem semantics.' : false,
}, async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-selected-range-'));
	const filePath = join(directory, 'large.aup4');
	const size = 7 * 1024 ** 3;
	const owner = {};
	const store = new ReadCapabilityStore();
	context.after(async () => {
		await store.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	const writer = await open(filePath, 'w+');
	try {
		await writer.truncate(size);
		await writer.write(Buffer.from('end'), 0, 3, size - 3);
	} finally { await writer.close(); }
	const descriptor = await store.registerSelectedRangePath(filePath, { owner });
	assert.equal(descriptor.size, size);
	assert.equal(descriptor.readProfile, 'selected-range-v1');
	const lease = store.acquireRequest(descriptor.id, descriptor.readProfile);
	assert.ok(lease);
	const parts = [];
	try {
		for await (const part of lease.createReadStream({ start: size - 3, end: size - 1, autoClose: false })) {
			parts.push(part);
		}
	} finally { await lease.close(); }
	assert.equal(Buffer.concat(parts).toString(), 'end');
	assert.equal(await store.release(descriptor.id, { owner }), true);
});

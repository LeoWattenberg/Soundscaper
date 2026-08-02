/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { READ_PROFILE_LINKED_VIDEO_RANGE_V1 } from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { DesktopLinkedVideoLocatorStore } from '../desktop/linked-video-locator-store.ts';
import { createProtocolHandler } from '../desktop/protocol.js';

test('an exact locator mints one pathless stable-handle playback lease', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-locator-playback-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const selectedPath = join(root, 'selected.mp4');
	const admittedPath = join(root, 'admitted.mp4');
	await writeFile(selectedPath, 'original-linked-video');
	const owner = {};
	const reads = new ReadCapabilityStore();
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: reads,
		randomBytes: deterministicTokens(),
	});
	context.after(async () => {
		await store.dispose();
		await reads.dispose();
	});
	const locator = await store.registerPath(selectedPath, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	const lease = await store.leaseRange(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
	});
	assert.ok(lease);
	assert.equal(lease.locatorRevision, locator.locatorRevision);
	assert.equal(lease.descriptor.readProfile, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	assert.equal('path' in lease, false);
	assert.equal('path' in lease.descriptor, false);

	await rename(selectedPath, admittedPath);
	await writeFile(selectedPath, 'replacement');
	const handler = createProtocolHandler({ rendererRoot: root, runtimeRoot: root, readCapabilities: reads });
	const response = await handler(new Request(lease.descriptor.url, {
		headers: { Range: `bytes=0-${lease.descriptor.size - 1}` },
	}));
	assert.equal(response.status, 206);
	assert.equal(await response.text(), 'original-linked-video');
	assert.equal(await reads.release(lease.descriptor.id, { owner }), true);
	assert.equal((await handler(new Request(lease.descriptor.url, {
		headers: { Range: 'bytes=0-0' },
	}))).status, 404);
	assert.equal(await store.leaseRange(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
	}), null, 'a later lease rejects the replacement pathname');
});

test('playback leasing requires an exact revision and forwards the locator identity', async () => {
	const expectedIdentity = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 };
	const registrations: unknown[] = [];
	const owner = {};
	const selectedPath = join(tmpdir(), 'selected.mp4');
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: {
			registerMaterializedPath: async () => { throw new Error('materialized read'); },
			registerLinkedOriginalRangePath: async (path, options) => {
				registrations.push({ path, options });
				return playbackDescriptor();
			},
			release: async () => true,
		},
		randomBytes: deterministicTokens(),
		stat: async () => ({ ...expectedIdentity, isFile: () => true }),
	});
	const locator = await store.registerPath(selectedPath, {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	await assert.rejects(
		store.leaseRange(locator.locatorId, { owner, expectedRevision: null, expectedKind: 'video' }),
		/exact|revision/iu,
	);
	const loaded = await store.leaseRange(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
	});
	assert.ok(loaded);
	assert.deepEqual(registrations, [{
		path: selectedPath,
		options: {
			kind: 'video',
			owner,
			mimeType: 'video/mp4',
			displayName: 'selected.mp4',
			expectedIdentity,
		},
	}]);
});

test('playback leasing retires a descriptor that does not match its locator snapshot', async () => {
	const expectedIdentity = { dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 };
	const releases: unknown[] = [];
	const owner = {};
	const store = new DesktopLinkedVideoLocatorStore({
		readCapabilities: {
			registerMaterializedPath: async () => { throw new Error('materialized read'); },
			registerLinkedOriginalRangePath: async () => ({
				...playbackDescriptor(),
				readProfile: 'materialized-v1',
			}),
			release: async (id, options) => {
				releases.push({ id, options });
				return true;
			},
		},
		randomBytes: deterministicTokens(),
		stat: async () => ({ ...expectedIdentity, isFile: () => true }),
	});
	const locator = await store.registerPath(join(tmpdir(), 'selected.mp4'), {
		owner,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
	});
	await assert.rejects(store.leaseRange(locator.locatorId, {
		owner, expectedRevision: locator.locatorRevision, expectedKind: 'video',
	}), /does not match/iu);
	assert.deepEqual(releases, [{ id: 'f'.repeat(64), options: { owner } }]);
});

function playbackDescriptor() {
	const id = 'f'.repeat(64);
	return Object.freeze({
		id,
		url: `soundscaper-app://bundle/_desktop/read/linked-video-range-v1/${id}/selected.mp4`,
		name: 'selected.mp4',
		size: 3,
		mimeType: 'video/mp4',
		readProfile: READ_PROFILE_LINKED_VIDEO_RANGE_V1,
		lastModified: 4,
	});
}

function deterministicTokens(): (size: number) => Uint8Array {
	let value = 0;
	return (size) => new Uint8Array(size).fill(++value);
}

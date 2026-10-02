/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { FileHandle } from 'node:fs/promises';
import test from 'node:test';
import { DesktopLinkedVideoLocatorStore, type DesktopLinkedVideoReadCapabilityStore } from '../desktop/linked-video-locator-store.ts';
import type { PersistedLinkedVideoLocator } from '../desktop/linked-video-locator-registry.ts';
import type { DesktopSaveSizeWarning } from '../desktop/save-size-warning-dialog.ts';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { assertDesktopLinkedAudioReadProfile, assertDesktopLinkedVideoReadProfile } from '../src/common/editor/desktop-read-profile.ts';

const bytes = 66 * 1024 ** 3;
const metadata = { dev: 1, ino: 2, size: bytes, mtimeMs: 3, ctimeMs: 4, isFile: () => true };
const reads: DesktopLinkedVideoReadCapabilityStore = {
	registerMaterializedPath: () => { throw new Error('unused'); },
	registerLinkedOriginalRangePath: (_path, options) => ({
		id: 'c'.repeat(64), url: 'unused', name: options.displayName, size: bytes,
		mimeType: options.mimeType, lastModified: 3, readProfile: `linked-${options.kind}-range-v1`,
	}),
	release: () => true,
};

test('native linked-file approval precedes locator minting and persists large audio/video identities', async () => {
	for (const kind of ['audio', 'video'] as const) {
		let minted = 0;
		const warnings: DesktopSaveSizeWarning[] = [];
		let persisted: readonly PersistedLinkedVideoLocator[] = [];
		const name = kind === 'audio' ? 'large.rf64' : 'large.mov';
		const store = new DesktopLinkedVideoLocatorStore({
			readCapabilities: reads, stat: () => metadata,
			registry: { read: () => [], write: (entries) => { persisted = entries; } },
			randomBytes: (size) => { minted += 1; return new Uint8Array(size).fill(minted); },
			confirmFileSizeWarning: async (warning) => { assert.equal(minted, 0); warnings.push(warning); return true; },
		});
		const owner = {};
		const locator = await store.registerPath(`/tmp/${name}`, {
			kind, owner, displayName: name, mimeType: kind === 'audio' ? 'audio/rf64' : 'video/quicktime',
		});
		assert.equal(locator.size, bytes);
		assert.deepEqual(warnings, [{ fileName: name, byteLength: bytes, thresholdBytes: 512 * 1024 ** 2 }]);
		assert.equal(persisted[0]?.size, bytes);
		const descriptor = (await store.leaseRange(locator.locatorId, {
			owner, expectedKind: kind, expectedRevision: locator.locatorRevision,
		}))?.descriptor;
		assert.ok(descriptor);
		(kind === 'audio' ? assertDesktopLinkedAudioReadProfile : assertDesktopLinkedVideoReadProfile)(descriptor);
		await store.dispose();
	}
});

test('cancelled, revoked, or changed linked-file warnings mint and persist no locator', async () => {
	for (const outcome of ['cancel', 'revoke', 'change', 'truthy'] as const) {
		const owner = {};
		let changed = false;
		let minted = 0;
		let written = 0;
		const store = new DesktopLinkedVideoLocatorStore({
			readCapabilities: reads, stat: () => ({ ...metadata, ino: changed ? 9 : 2 }),
			randomBytes: (size) => { minted += 1; return new Uint8Array(size); },
			registry: { read: () => [], write: () => { written += 1; } },
			confirmFileSizeWarning: async () => {
				if (outcome === 'revoke') store.revokeOwner(owner);
				if (outcome === 'change') changed = true;
				return outcome === 'truthy' ? 'accepted' as unknown as boolean : outcome !== 'cancel';
			},
		});
		await assert.rejects(store.registerPath('/tmp/large.mov', {
			owner, displayName: 'large.mov', mimeType: 'video/quicktime',
		}), /cancel|revoked|changed/iu);
		assert.equal(minted, 0);
		assert.equal(written, 0);
		await store.dispose();
	}
});

test('native materialization approval admits one resident-file budget and checks owner and exact identity', async () => {
	const owner = {};
	let confirmed = 0;
	let closed = 0;
	const store = new ReadCapabilityStore({
		confirmFileSizeWarning: async (warning: DesktopSaveSizeWarning) => {
			assert.equal(warning.byteLength, bytes); confirmed += 1; return true;
		},
		openImpl: async () => ({ stat: async () => metadata, close: async () => { closed += 1; } } as unknown as FileHandle),
	});
	try {
		const descriptor = await store.registerMaterializedPath('/tmp/large.mov', { owner });
		assert.equal(descriptor.size, bytes);
		assert.equal(confirmed, 1);
		await assert.rejects(store.registerMaterializedPath('/tmp/large.mov', { owner }), /byte|limit/iu);
		assert.equal(closed, 1);
		assert.equal(await store.release(descriptor.id, { owner }), true);
	} finally { await store.dispose(); }
});

test('materialization cancellation, owner revocation and changed identities close the unminted handle', async () => {
	for (const outcome of ['cancel', 'revoke', 'change', 'truthy'] as const) {
		const owner = {};
		let closed = 0;
		let changed = false;
		const store = new ReadCapabilityStore({
			confirmFileSizeWarning: async () => {
				if (outcome === 'revoke') void store.revokeOwner(owner);
				if (outcome === 'change') changed = true;
				return outcome === 'truthy' ? 'accepted' as unknown as boolean : outcome !== 'cancel';
			},
			openImpl: async () => ({
				stat: async () => ({ ...metadata, ino: changed ? 9 : 2 }),
				close: async () => { closed += 1; },
			} as unknown as FileHandle),
		});
		try {
			await assert.rejects(store.registerMaterializedPath('/tmp/large.mov', { owner }), /cancel|revoked|changed/iu);
			assert.equal(closed, 1);
		} finally { await store.dispose(); }
	}
});

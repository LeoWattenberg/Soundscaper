/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePhotoDevelopProxyCustodyV1 } from './helpers/lightscaper-develop-proxy-native-observer.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';

const sha256 = 'a'.repeat(64), token = 'media-content-abcdefghijklmnop';
const photo = { id: 'photo', catalogId: 'catalog', original: {
	schemaVersion: 1, kind: 'still', id: 'source', name: 'Pattern.png', mimeType: 'image/png', storageKey: 'asset',
	contentSha256: sha256, width: 4096, height: 3072, hasAlpha: false, byteLength: 17, retention: 'managed',
} satisfies PhotoOriginalV1 };
const root = { schemaVersion: 1, key: '["catalog",null,"photo"]', catalogId: 'catalog', importId: null,
	scope: '["catalog",null]', photoId: 'photo', assetId: 'asset', sourceId: 'source', sha256, size: 17, mediaContentToken: token };
const metadata = { sourceId: 'asset', sha256, size: 17, storage: 'opfs', path: 'retained.png' };
const record = { ...metadata, mediaContentToken: token, mediaContentDigestVersion: 1, catalogRootCount: 1 };
function read(overrides: { raw?: unknown; rows?: readonly unknown[]; publicRows?: readonly unknown[];
	publicAfterKey?: string | null; digest?: string; size?: number; metadata?: Record<string, unknown> } = {}) {
	return validatePhotoDevelopProxyCustodyV1(photo, overrides.metadata ?? metadata, overrides.raw ?? record,
		overrides.rows ?? [root], { roots: overrides.publicRows ?? [root], afterKey: overrides.publicAfterKey ?? null },
		overrides.digest ?? sha256, overrides.size ?? 17);
}

test('Lightscaper proxy custody binds independently read original body, scalar record and complete public/native roots', () => {
	const observed = read();
	assert.equal(observed.sha256, sha256); assert.equal(observed.byteLength, 17);
	assert.equal(observed.mediaContentToken, token); assert.equal(observed.recordJson, JSON.stringify(record));
	assert.deepEqual(observed.metadata, metadata); assert.deepEqual(observed.roots, [root]); assert.deepEqual(observed.publicRoots, [root]);
	// The real streamed OPFS writer retains undefined optional chunk fields.
	const opfs = read({ raw: { ...record, mediaChunkBytes: undefined, mediaChunkCount: undefined } });
	assert.equal(opfs.recordJson, JSON.stringify(record)); assert.equal(opfs.mediaContentToken, token);
});

test('Lightscaper proxy custody refuses a missing, extra, provisional or foreign original root', () => {
	for (const rows of [[], [root, root], [{ ...root, importId: 'pending', key: '["catalog","pending","photo"]', scope: '["catalog","pending"]' }],
		[{ ...root, photoId: 'foreign', key: '["catalog",null,"foreign"]' }], [{ ...root, sourceId: 'foreign' }]]) {
		assert.throws(() => read({ rows }));
	}
	assert.throws(() => read({ publicRows: [] })); assert.throws(() => read({ publicAfterKey: root.key }));
	assert.throws(() => read({ publicRows: [{ ...root, mediaContentToken: 'media-content-anotherlongtoken' }] }));
});

test('Lightscaper proxy custody refuses substituted body, metadata or hidden content token', () => {
	assert.throws(() => read({ digest: 'b'.repeat(64) })); assert.throws(() => read({ size: 18 }));
	for (const raw of [{ ...record, mediaContentToken: 'media-content-anotherlongtoken' }, { ...record, sourceId: 'foreign' },
		{ ...record, sha256: 'b'.repeat(64) }, { ...record, size: 18 }, { ...record, blob: new Blob(['opaque']) }]) assert.throws(() => read({ raw }));
	assert.throws(() => read({ metadata: { ...metadata, sha256: 'b'.repeat(64) } }));
	assert.throws(() => read({ metadata: { ...metadata, size: 18 } }));
});

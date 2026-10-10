/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createImageDevelopHandoffProvenanceV1, normalizeImageDevelopHandoffProvenanceV1, imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';

const original = { exactName: 'e\u0301 original.png', sha256: 'a'.repeat(64), byteLength: 17 };
const origin = { schemaFamily: 'lightscaper', schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 4,
	versionId: 'copy', versionKind: 'virtual-copy', versionName: 'Saved crop', versionCreatedAt: '2026-10-01T00:00:00.000Z' };

test('handoff provenance retains exact original spelling and a deterministic typed recipe digest without body authority', () => {
	const develop = defaultImageDevelopStateV2(), value = createImageDevelopHandoffProvenanceV1({ origin, original, develop });
	assert.equal(value.original.exactName, original.exactName);
	assert.equal(value.developSha256, createHash('sha256').update(JSON.stringify(develop)).digest('hex'));
	assert.deepEqual(normalizeImageDevelopHandoffProvenanceV1(JSON.parse(JSON.stringify(value))), value);
	assert.equal(Object.isFrozen(value.origin), true); assert.equal(Object.isFrozen(value.original), true);
	assert.notEqual(imageDevelopHandoffRecipeSha256V1({ ...develop, processVersion: 1 }), value.developSha256);
});

test('Frame provenance preserves source and sequence identities independently of local storage identifiers', () => {
	const value = createImageDevelopHandoffProvenanceV1({ original, develop: defaultImageDevelopStateV2(),
		origin: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project', revision: 8, sourceId: 'remote-source', sequenceId: 'selected-sequence', clipId: 'clip' } });
	assert.equal(value.origin.schemaFamily, 'framescaper'); assert.equal('sourceId' in value.origin && value.origin.sourceId, 'remote-source');
	assert.throws(() => normalizeImageDevelopHandoffProvenanceV1({ ...value, schemaVersion: 2 }));
	assert.throws(() => normalizeImageDevelopHandoffProvenanceV1({ ...value, storageKey: 'parallel-authority' }));
});

test('closed provenance refuses accessors, invalid version bindings, timestamps and recipe versions', () => {
	let reads = 0;
	assert.throws(() => createImageDevelopHandoffProvenanceV1({ origin, original: { ...original, get sha256() { reads++; return original.sha256; } }, develop: defaultImageDevelopStateV2() }));
	assert.equal(reads, 0);
	for (const replacement of [{ versionCreatedAt: '2026-02-31T00:00:00.000Z' }, { photoId: '../photo' }, { schemaVersion: 3 }]) {
		assert.throws(() => createImageDevelopHandoffProvenanceV1({ origin: { ...origin, ...replacement }, original, develop: defaultImageDevelopStateV2() }));
	}
	assert.throws(() => imageDevelopHandoffRecipeSha256V1({ ...defaultImageDevelopStateV2(), processVersion: 3 }));
	assert.throws(() => createImageDevelopHandoffProvenanceV1({ origin: { ...origin, schemaVersion: 1 }, original, develop: defaultImageDevelopStateV2() }));
});

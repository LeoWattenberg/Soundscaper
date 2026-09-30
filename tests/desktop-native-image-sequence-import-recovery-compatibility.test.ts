/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFramescaperNativeImageSequenceManifest } from
	'../desktop/native-image-sequence-import-contract.ts';
import { imageSequenceStorageSha256 } from
	'../desktop/native-image-sequence-import-storage.ts';

const DIGEST = 'a'.repeat(64);
const TRANSACTION_ID = 'b'.repeat(40);

test('image-sequence recovery accepts legacy reference order and returns canonical references', () => {
	const pack = {
		byteLength: 12, sha256: DIGEST,
		storageKey: `image-sequence-pack-sha256:${DIGEST}`,
		kind: 'image-sequence-source-pack',
	};
	const inventory = {
		lastFrameNumber: 11, firstFrameNumber: 10, frameCount: 2, byteLength: 34,
		sha256: DIGEST, storageKey: `image-sequence-inventory-sha256:${DIGEST}`,
		version: 1, kind: 'image-sequence-inventory',
	};
	const body = {
		version: 1, schemaFamily: 'framescaper', schemaVersion: 1,
		transactionId: TRANSACTION_ID, projectId: 'project-one', projectRevision: 4,
		sourceId: 'source-one', pack, inventory,
	};
	const parsed = parseFramescaperNativeImageSequenceManifest(
		new TextEncoder().encode(JSON.stringify({
			...body, authenticator: imageSequenceStorageSha256(JSON.stringify(body)),
		})),
		TRANSACTION_ID,
	);

	assert.deepEqual(Object.keys(parsed.pack!), ['kind', 'storageKey', 'sha256', 'byteLength']);
	assert.deepEqual(Object.keys(parsed.inventory!), [
		'kind', 'version', 'storageKey', 'sha256', 'byteLength',
		'frameCount', 'firstFrameNumber', 'lastFrameNumber',
	]);
	assert.deepEqual(parsed.pack, {
		kind: pack.kind, storageKey: pack.storageKey, sha256: DIGEST, byteLength: 12,
	});
	assert.deepEqual(parsed.inventory, {
		kind: inventory.kind, version: 1, storageKey: inventory.storageKey,
		sha256: DIGEST, byteLength: 34, frameCount: 2,
		firstFrameNumber: 10, lastFrameNumber: 11,
	});
});

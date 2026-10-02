/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { normalizeVideoProxyClaimRecord } from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import { createUnverifiedVideoProxyClaim, normalizeVideoProxyClaimStagingInput } from '../src/common/editor/storage/video-proxy-claim-staging-record.ts';

const BYTE_LENGTH = 512 * 1024 * 1024 + 1;
const DIGEST = 'ab'.repeat(32);
const BODY_KEY = `video-proxy-sha256:${DIGEST}`;
const INPUT = Object.freeze({ operationId: 'large-proxy-operation', projectId: 'large-proxy-project',
	sourceId: 'video-source', baseFingerprint: 'cd'.repeat(32), bodyKind: 'proxy' as const,
	bodyKey: BODY_KEY, byteLength: BYTE_LENGTH, mimeType: 'video/mp4' });
const ROW = Object.freeze({ sourceId: BODY_KEY, kind: 'video-proxy', encoding: 'video-proxy-v1',
	storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE, mediaChunkToken: 'large-proxy-chunks-0000000001', mediaChunkBytes: 4 * 1024 * 1024,
	mediaChunkCount: Math.ceil(BYTE_LENGTH / (4 * 1024 * 1024)), size: BYTE_LENGTH, mimeType: 'video/mp4',
	mediaContentDigestVersion: 1, mediaContentToken: 'media-content-proxy-0000000000000001', sha256: DIGEST });

test('an approved large proxy retains its exact chunk-backed claim through persisted normalization', () => {
	assert.equal(normalizeVideoProxyClaimStagingInput(INPUT).byteLength, BYTE_LENGTH);
	const claim = createUnverifiedVideoProxyClaim(ROW, INPUT, { now: 100, generation: 'large-proxy-generation' });
	assert.equal(claim.rowIdentity.byteLength, BYTE_LENGTH);
	assert.equal(claim.rowIdentity.mediaChunkCount, 129);
	assert.deepEqual(normalizeVideoProxyClaimRecord(claim), claim);
});

test('large proxy claim admission still rejects changed digest, size, and chunk ownership', () => {
	for (const replacement of [{ sha256: 'ef'.repeat(32) }, { size: BYTE_LENGTH - 1 },
		{ mediaChunkCount: 128 }, { mediaChunkBytes: 1024 }, { mediaContentToken: 'invalid' }]) {
		assert.throws(() => createUnverifiedVideoProxyClaim({ ...ROW, ...replacement }, INPUT),
			/provenance|metadata|geometry/iu);
	}
	assert.throws(() => normalizeVideoProxyClaimStagingInput({ ...INPUT, byteLength: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/iu);
});

test('timing records retain the format-derived byte bound', () => {
	assert.throws(() => normalizeVideoProxyClaimStagingInput({ ...INPUT, bodyKind: 'timing',
		bodyKey: `video-timing-sha256:${DIGEST}`, mimeType: 'application/vnd.soundscaper.video-timing',
		byteLength: 16_000_033 }), /byte limit/iu);
});

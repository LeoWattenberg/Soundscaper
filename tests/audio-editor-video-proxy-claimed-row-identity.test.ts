/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sameVideoProxyClaimBodyRow } from '../src/common/editor/storage/video-proxy-claim-row-identity.ts';
import type { VideoProxyClaimRowIdentity } from '../src/common/editor/storage/video-proxy-claim-repository.ts';

test('archive and preservation bind every verified body row field to the claim', () => {
	const identity: VideoProxyClaimRowIdentity = {
		sourceId: 'body', kind: 'video-proxy', encoding: 'video-proxy-v1', storage: 'opfs',
		path: 'managed/body', mediaChunkToken: null, mediaChunkBytes: null, mediaChunkCount: null,
		mediaContentDigestVersion: 1, mediaContentToken: 'token', sha256: 'a'.repeat(64),
		byteLength: 8, mimeType: 'video/webm',
	};
	const row = { ...identity, size: identity.byteLength };
	assert.equal(sameVideoProxyClaimBodyRow(row, identity), true);
	for (const field of ['sourceId', 'kind', 'encoding', 'storage', 'path', 'mediaChunkToken',
		'mediaChunkBytes', 'mediaChunkCount', 'mediaContentDigestVersion', 'mediaContentToken',
		'sha256', 'size', 'mimeType'] as const) {
		assert.equal(sameVideoProxyClaimBodyRow({ ...row, [field]: 'changed' }, identity), false, field);
	}
	assert.equal(sameVideoProxyClaimBodyRow({ ...row, path: undefined }, { ...identity, path: null }), true);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	binaryMetadata,
	candidateEligibleAt,
	protectSourceDependencies,
	sourceNeedsLegacyPcmMigration,
	sourceStorageCandidates,
	videoDerivativeIdentity,
} from '../src/common/editor/storage/media-records.ts';

test('media record identity and metadata normalization preserve wire-safe fields', () => {
	assert.deepEqual(videoDerivativeIdentity(' source ', 1.5, ' poster '), {
		key: '["source","poster",1.5]',
		sourceId: 'source',
		timestamp: 1.5,
		type: 'poster',
	});
	assert.deepEqual(binaryMetadata({ sourceId: 'source', blob: 'bytes', custom: 1 }), { custom: 1 });
	assert.throws(() => videoDerivativeIdentity('', 0, 'poster'), /source id/u);
});

test('storage collection candidates retain dependencies and the latest eligibility time', () => {
	const sources = [
		{ id: 'base', committedAt: '2026-01-01T00:00:00.000Z' },
		{ id: 'derived', baseSourceId: 'base', storage: 'copy-on-write', pcmEncodingVersion: 0 },
	];
	const media = [{ sourceId: 'derived', pendingProjectUntil: '2026-01-03T00:00:00.000Z' }];
	const derivatives = [{ sourceId: 'derived', committedAt: '2026-01-02T00:00:00.000Z' }];
	const candidates = sourceStorageCandidates(sources, media, derivatives);
	assert.deepEqual([...protectSourceDependencies(new Set(['derived']), sources)].sort(), ['base', 'derived']);
	assert.equal(sourceNeedsLegacyPcmMigration(sources[1]), true);
	assert.equal(candidateEligibleAt(candidates.get('derived'), 86_400_000), Date.parse('2026-01-03T00:00:00.000Z'));
});

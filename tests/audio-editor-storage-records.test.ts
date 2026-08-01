/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	binaryMetadata,
	candidateEligibleAt,
	protectSourceDependencies,
	sourceNeedsLegacyPcmMigration,
	sourceStorageCandidates,
} from '../src/common/editor/storage/media-records.ts';
import {
	VIDEO_DERIVATIVE_RECIPES,
	videoDerivativeIdentity,
} from '../src/common/editor/storage/video-derivative-relationship.ts';

test('media record identity and metadata normalization preserve wire-safe fields', () => {
	const identity = videoDerivativeIdentity(
		' source ', 'a'.repeat(64), 1.5, 'poster', VIDEO_DERIVATIVE_RECIPES.poster,
	);
	assert.match(identity.key, /^video-derivative-sha256:[a-f0-9]{64}$/u);
	assert.deepEqual({ ...identity, key: null }, {
		key: null,
		sourceId: 'source',
		timestamp: 1.5,
		type: 'poster',
		derivativeBindingVersion: 1,
		originalSha256: 'a'.repeat(64),
		recipeId: VIDEO_DERIVATIVE_RECIPES.poster.id,
		recipeVersion: VIDEO_DERIVATIVE_RECIPES.poster.version,
	});
	assert.deepEqual(binaryMetadata({
		sourceId: 'source', blob: 'bytes', sha256: 'spoof', originalSha256: 'spoof', custom: 1,
	}), { custom: 1 });
	assert.throws(
		() => videoDerivativeIdentity('', 'a'.repeat(64), 0, 'poster'),
		/original media storage key/u,
	);
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

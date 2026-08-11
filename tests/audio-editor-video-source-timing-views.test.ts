/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVideoSourceTimingViews } from '../src/common/editor/video-source-timing-views.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SOURCE_SHA256 = '71'.repeat(32);
const CFR_RATE = Object.freeze({ num: 30_000, den: 1_001 });

test('source timing views derive CFR authority from the persisted timing decision', () => {
	const source = Object.freeze({
		id: 'camera-cfr',
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: CFR_RATE,
		sourceFrameCount: 240,
		timingAsset: null,
		timingDecision: Object.freeze({ mode: 'conform-cfr-at-ingest', rate: CFR_RATE }),
	});
	const project = Object.freeze({
		sources: Object.freeze([
			Object.freeze({ id: 'dialogue', kind: 'audio' }),
			source,
		]),
	});

	const views = resolveVideoSourceTimingViews(project);

	assert.equal(views.size, 1);
	assert.deepEqual(views.get(source.id), {
		kind: 'cfr',
		rate: CFR_RATE,
		frameCount: source.sourceFrameCount,
	});
});

test('source timing views preserve exact verified VFR index and persisted reference identity', () => {
	const timing = publication([0n, 40n, 105n], 55n);
	const index = validateVideoTimingAssetBytes(timing.reference, timing.bytes);
	const source = exactSource('camera-vfr', timing.reference);
	registerVideoTimingIndex(source, index);
	try {
		const view = resolveVideoSourceTimingViews(project(source)).get(source.id);
		assert.equal(view?.kind, 'vfr');
		if (view?.kind !== 'vfr') assert.fail('Expected a VFR timing view.');
		assert.equal(view.index, index, 'the verified registry object must not be reconstructed');
		assert.equal(view.reference, source.timingAsset, 'the persisted reference must retain its identity');
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('source timing views omit exact sources whose verified timing is not registered', () => {
	const timing = publication([0n, 50n, 115n], 45n);
	const source = exactSource('missing-vfr', timing.reference);

	assert.equal(resolveVideoSourceTimingViews(project(source)).has(source.id), false);
});

test('source timing views omit a stale registry entry verified for a different persisted reference', () => {
	const oldTiming = publication([0n, 40n, 100n], 60n);
	const currentTiming = publication([0n, 50n, 105n], 55n);
	const oldSource = exactSource('reprobed-camera', oldTiming.reference);
	const currentSource = exactSource('reprobed-camera', currentTiming.reference);
	const staleIndex = validateVideoTimingAssetBytes(oldTiming.reference, oldTiming.bytes);
	registerVideoTimingIndex(oldSource, staleIndex);
	try {
		assert.equal(resolveVideoSourceTimingViews(project(currentSource)).has(currentSource.id), false);
	} finally {
		unregisterVideoTimingIndex(currentSource);
	}
});

test('source timing views omit structurally valid but unverified registered timing', () => {
	const timing = publication([0n, 40n, 105n], 55n);
	const source = exactSource('unverified-camera', timing.reference);
	registerVideoTimingIndex(source, Object.freeze({
		encoding: timing.reference.encoding,
		timescale: 1_000,
		frameCount: 3,
		presentationTicks: Object.freeze([0n, 40n, 105n]),
		finalFrameDurationTicks: 55n,
		endTicks: 160n,
	}));
	try {
		assert.equal(resolveVideoSourceTimingViews(project(source)).has(source.id), false);
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('source timing view output is frozen and rejects ordinary Map mutation', () => {
	const source = Object.freeze({
		id: 'immutable-cfr',
		kind: 'video',
		contentSha256: SOURCE_SHA256,
		frameRate: CFR_RATE,
		sourceFrameCount: 12,
		timingAsset: null,
		timingDecision: Object.freeze({ mode: 'conform-cfr-at-ingest', rate: CFR_RATE }),
	});
	const views = resolveVideoSourceTimingViews(project(source));
	const view = views.get(source.id);

	assert.equal(Object.isFrozen(views), true);
	assert.equal(Object.isFrozen(view), true);
	assert.equal(view?.kind === 'cfr' && Object.isFrozen(view.rate), true);
	assert.throws(() => (views as Map<string, unknown>).set('intruder', Object.freeze({})), /immutable/iu);
	assert.throws(() => (views as Map<string, unknown>).delete(source.id), /immutable/iu);
	assert.equal(views.get(source.id), view);
});

function project(source: Readonly<Record<string, unknown>>): Readonly<{ sources: readonly unknown[] }> {
	return Object.freeze({ sources: Object.freeze([source]) });
}

function exactSource(
	id: string,
	timingAsset: ReturnType<typeof publication>['reference'],
): Readonly<{
	id: string;
	kind: 'video';
	contentSha256: string;
	frameRate: typeof CFR_RATE;
	sourceFrameCount: number;
	timingAsset: typeof timingAsset;
	timingDecision: Readonly<{ mode: 'exact'; rate: typeof CFR_RATE; backend: string }>;
}> {
	return Object.freeze({
		id,
		kind: 'video' as const,
		contentSha256: SOURCE_SHA256,
		frameRate: CFR_RATE,
		sourceFrameCount: timingAsset.frameCount,
		timingAsset,
		timingDecision: Object.freeze({ mode: 'exact' as const, rate: CFR_RATE, backend: 'demuxer' }),
	});
}

function publication(
	presentationTicks: readonly bigint[],
	finalFrameDurationTicks: bigint,
) {
	return createVideoTimingAssetPublication(SOURCE_SHA256, {
		timescale: 1_000,
		presentationTicks,
		finalFrameDurationTicks,
	});
}

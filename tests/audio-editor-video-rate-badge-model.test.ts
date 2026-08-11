/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoRateBadgeModel,
} from '../src/common/editor/ui/timeline/video-rate-badge-model.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const SOURCE_SHA = '8'.repeat(64);
const RATE = Object.freeze({ num: 24, den: 1 });

test('CFR badge derives fixed-source/program rate and ignores stale speedRatio', () => {
	const source = cfrSource();
	const clip = videoClip({ durationFrames: 24_000, speedRatio: 9 });
	registerVideoTimingIndex(source, Object.freeze({
		encoding: 'soundscaper-video-timing-v1',
		timescale: 1_000,
		frameCount: 24,
		presentationTicks: Object.freeze(Array.from({ length: 24 }, (_, index) => BigInt(index) * 1_000n)),
		finalFrameDurationTicks: 1_000n,
		endTicks: 24_000n,
	}));
	try {
		const badge = createVideoRateBadgeModel({ clip, source, projectSampleRate: 48_000 });
		assert.deepEqual(badge, { playbackRate: 2, label: '2.00×' });
		assert.ok(Object.isFrozen(badge));
	} finally {
		unregisterVideoTimingIndex(source);
	}
	assert.equal(createVideoRateBadgeModel({
		clip: { ...clip, durationFrames: 48_000, speedRatio: 9 },
		source,
		projectSampleRate: 48_000,
	}), null, 'identity rate does not display a stale persisted speed ratio');
});

test('exact VFR badge fails closed until matching verified timing is registered', () => {
	const publication = createVideoTimingAssetPublication(SOURCE_SHA, {
		timescale: 1_000,
		presentationTicks: [0n, 100n, 300n],
		finalFrameDurationTicks: 200n,
	});
	const source = Object.freeze({
		id: 'vfr-source',
		kind: 'video' as const,
		contentSha256: SOURCE_SHA,
		frameRate: RATE,
		sourceFrameCount: 3,
		timingAsset: publication.reference,
		timingDecision: Object.freeze({ mode: 'exact' as const, rate: RATE, backend: 'demuxer' }),
	});
	const clip = videoClip({ sourceId: source.id, sourceDurationFrames: 3, durationFrames: 12_000 });
	assert.equal(createVideoRateBadgeModel({ clip, source, projectSampleRate: 48_000 }), null);

	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	registerVideoTimingIndex(source, index);
	try {
		assert.deepEqual(createVideoRateBadgeModel({
			clip, source, projectSampleRate: 48_000,
		}), { playbackRate: 2, label: '2.00×' });
	} finally {
		unregisterVideoTimingIndex(source);
	}
	assert.equal(createVideoRateBadgeModel({ clip, source, projectSampleRate: 48_000 }), null);
});

test('badge fails closed for malformed, mismatched, audio, or absent authority', () => {
	const source = cfrSource();
	for (const row of [
		{ clip: videoClip(), source: { ...source, timingDecision: { mode: 'exact', rate: RATE } } },
		{ clip: videoClip(), source: { ...source, frameRate: { num: 25, den: 1 } } },
		{ clip: { ...videoClip(), kind: 'audio' }, source },
		{ clip: videoClip(), source: null },
		{ clip: { ...videoClip(), durationFrames: 0 }, source },
	] as const) {
		assert.equal(createVideoRateBadgeModel({
			clip: row.clip, source: row.source, projectSampleRate: 48_000,
		}), null);
	}
});

function cfrSource() {
	return Object.freeze({
		id: 'video-source',
		kind: 'video' as const,
		contentSha256: SOURCE_SHA,
		frameRate: RATE,
		sourceFrameCount: 24,
		timingAsset: null,
		timingDecision: Object.freeze({ mode: 'conform-cfr-at-ingest' as const, rate: RATE }),
	});
}

function videoClip(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		id: 'video',
		kind: 'video' as const,
		sourceId: 'video-source',
		timelineStartFrame: 0,
		durationFrames: 24_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 24,
		sourceInFrame: 0,
		sourceFrameCount: 24,
		speedRatio: 9,
		...overrides,
	});
}

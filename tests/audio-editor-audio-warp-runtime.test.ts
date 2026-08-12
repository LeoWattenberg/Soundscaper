/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioWarpMapFingerprint,
	audioWarpSourceWindowRange,
	createAudioWarpRenderPathStatus,
	buildAudioWarpRuntimeSegments,
	evaluateAudioWarpRenderParity,
	evaluateAudioWarpSourceFrame,
	selectAudioWarpRenderPath,
} from '../src/common/editor/audio-warp-runtime.ts';

const SAMPLE_PROJECT = Object.freeze({
	sampleRate: 48_000,
	tempoMap: {
		mode: 'musical' as const,
		events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	},
});

const SAMPLE_CLIP = Object.freeze({
	id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 100,
	durationFrames: 100, sourceStartFrame: 1_000, sourceDurationFrames: 200,
	warpMap: {
		feature: 'audio-warp' as const,
		points: [
			{ outer: 0, source: 1_000, mode: 'forward' as const },
			{ outer: 50, source: 1_050, mode: 'forward' as const },
			{ outer: 100, source: 1_200, mode: 'forward' as const },
		],
	},
});

test('sample-anchored warp segments share the exact map evaluator and one-round boundaries', () => {
	assert.deepEqual(evaluateAudioWarpSourceFrame(SAMPLE_PROJECT, SAMPLE_CLIP, 125), { num: 1_025, den: 1 });
	const segments = buildAudioWarpRuntimeSegments(SAMPLE_PROJECT, SAMPLE_CLIP, {
		startFrame: 125,
		endFrame: 175,
		sourceSampleRate: 96_000,
	});
	assert.deepEqual(segments.map((segment) => ({
		timelineStartFrame: segment.timelineStartFrame,
		timelineEndFrame: segment.timelineEndFrame,
		sourceStartFrame: segment.sourceStartFrame,
		sourceEndFrame: segment.sourceEndFrame,
		playbackRate: segment.playbackRate,
	})), [
		{
			timelineStartFrame: 125, timelineEndFrame: 150,
			sourceStartFrame: { num: 1_025, den: 1 }, sourceEndFrame: { num: 1_050, den: 1 },
			playbackRate: 0.5,
		},
		{
			timelineStartFrame: 150, timelineEndFrame: 175,
			sourceStartFrame: { num: 1_050, den: 1 }, sourceEndFrame: { num: 1_125, den: 1 },
			playbackRate: 1.5,
		},
	]);
});

test('musical warp segments split at held-tempo boundaries without changing source authority', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [
				{ id: 'intro', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'body', beat: { num: 2, den: 1 }, bpm: { num: 60, den: 1 } },
			],
		},
	};
	const clip = {
		id: 'musical', kind: 'audio', anchor: 'musical',
		musicalStartBeat: { num: 1, den: 1 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 2, den: 1 },
		timelineStartFrame: 24_000, durationFrames: 72_000,
		sourceStartFrame: 0, sourceDurationFrames: 72_000,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 2, source: 72_000, mode: 'forward' as const },
			],
		},
	};
	const segments = buildAudioWarpRuntimeSegments(project, clip, {
		startFrame: 24_000,
		endFrame: 96_000,
		sourceSampleRate: 48_000,
	});
	assert.deepEqual(segments.map((segment) => [
		segment.timelineStartFrame,
		segment.timelineEndFrame,
		segment.sourceStartFrame,
		segment.sourceEndFrame,
		segment.playbackRate,
	]), [
		[24_000, 48_000, { num: 0, den: 1 }, { num: 36_000, den: 1 }, 1.5],
		[48_000, 96_000, { num: 36_000, den: 1 }, { num: 72_000, den: 1 }, 0.75],
	]);
});

test('runtime maps require explicit clip endpoints and select only exact render paths', () => {
	assert.throws(() => buildAudioWarpRuntimeSegments(SAMPLE_PROJECT, {
		...SAMPLE_CLIP,
		warpMap: {
			...SAMPLE_CLIP.warpMap,
			points: SAMPLE_CLIP.warpMap.points.map((point, index) => index === 0
				? { ...point, source: 999 }
				: point),
		},
	}, { startFrame: 100, endFrame: 200, sourceSampleRate: 48_000 }), /source endpoints/iu);
	assert.equal(selectAudioWarpRenderPath({ realtimeAcceleration: true }), 'realtime');
	assert.equal(selectAudioWarpRenderPath({ realtimeAcceleration: false }), 'exact-offline');
	assert.throws(() => selectAudioWarpRenderPath({ realtimeAcceleration: false, exactOfflineAvailable: false }), /exact offline/iu);
});

test('runtime status exposes the selected native or exact-offline path and never scalar', () => {
	assert.deepEqual(createAudioWarpRenderPathStatus({
		realtimeAcceleration: true,
		exactOfflineAvailable: true,
	}), {
		path: 'realtime',
		realtimeAcceleration: true,
		exactOfflineAvailable: true,
		fallback: false,
	});
	assert.deepEqual(createAudioWarpRenderPathStatus({
		realtimeAcceleration: false,
		exactOfflineAvailable: true,
	}), {
		path: 'exact-offline',
		realtimeAcceleration: false,
		exactOfflineAvailable: true,
		fallback: true,
	});
	assert.doesNotMatch(JSON.stringify(createAudioWarpRenderPathStatus({
		realtimeAcceleration: false,
		exactOfflineAvailable: true,
	})), /scalar/iu);
});

test('realtime segment projection and exact offline evaluator agree across the shared error budget', () => {
	const parity = evaluateAudioWarpRenderParity(SAMPLE_PROJECT, SAMPLE_CLIP, {
		startFrame: 100,
		endFrame: 200,
		sourceSampleRate: 48_000,
	});
	assert.equal(parity.breakpointCount, 3);
	assert.ok(parity.comparedFrameCount >= 5);
	assert.ok(parity.maximumErrorFrames <= parity.errorBudgetFrames);
	assert.equal(parity.errorBudgetFrames, 0.000_001);
});

test('canonical map fingerprints are stable and authority-sensitive', () => {
	const canonical = audioWarpMapFingerprint(SAMPLE_CLIP.warpMap);
	assert.match(canonical, /^[a-f0-9]{64}$/u);
	assert.equal(audioWarpMapFingerprint(structuredClone(SAMPLE_CLIP.warpMap)), canonical);
	assert.notEqual(audioWarpMapFingerprint({
		...SAMPLE_CLIP.warpMap,
		points: SAMPLE_CLIP.warpMap.points.map((point, index) => index === 1
			? { ...point, source: 1_051 }
			: point),
	}), canonical);
});

test('waveform PCM reads use exact warped source bounds with bounded padding', () => {
	assert.deepEqual(audioWarpSourceWindowRange(SAMPLE_PROJECT, SAMPLE_CLIP, {
		startFrame: 25,
		endFrame: 75,
		sourceFrameCount: 2_000,
	}), { startFrame: 1_023, endFrame: 1_127 });
	assert.deepEqual(audioWarpSourceWindowRange(SAMPLE_PROJECT, SAMPLE_CLIP, {
		startFrame: 0,
		endFrame: 100,
		sourceFrameCount: 1_200,
	}), { startFrame: 998, endFrame: 1_200 });
});

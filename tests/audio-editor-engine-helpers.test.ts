import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getProjectDurationFrames,
	getProjectTimelineDurationFrames,
	normalizeLoop,
	normalizePreparedSpeedPlayback,
} from '../src/common/editor/engine/buffer-math.ts';
import {
	automaticCrossfadeRanges,
	buildClipSchedulePlans,
} from '../src/common/editor/engine/clip-schedule-plan.ts';
import { effectRackLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { projectGraphLatencyFrames } from '../src/common/editor/engine/project-graph.ts';

test('duration helpers preserve legacy clips and the minimum editor timeline', () => {
	const project = {
		sampleRate: 100,
		clips: [
			{ id: 'first', timelineStartFrame: 10, durationFrames: 30 },
			{ id: 'legacy', timelineStartFrames: 80, frameLength: 20 },
		],
	};
	assert.equal(getProjectDurationFrames(project), 100);
	assert.equal(getProjectTimelineDurationFrames(project), 3_000);
	assert.deepEqual(normalizeLoop({ enabled: true, startFrame: -4, endFrame: 120 }, 100), {
		enabled: true,
		startFrame: 0,
		endFrame: 100,
	});
});

test('prepared speed playback validates and normalizes matching planar PCM', () => {
	const prepared = normalizePreparedSpeedPlayback([
		Float32Array.of(0.25, 0.5),
		[0.75, 1],
	], 48_000, 96_000, 1.5);
	assert.equal(prepared.frameCount, 2);
	assert.equal(prepared.sampleRate, 48_000);
	assert.equal(prepared.playbackRate, 1.5);
	assert.ok(prepared.channels.every((channel) => channel instanceof Float32Array));
	assert.throws(
		() => normalizePreparedSpeedPlayback([Float32Array.of(1), Float32Array.of(1, 2)], 48_000, 1, 1),
		/matching frame length/,
	);
});

test('crossfade and schedule plans retain clip-local overlap and source offsets', () => {
	const project = {
		tracks: [{ id: 'track', type: 'audio', clipIds: ['first', 'second'] }],
		clips: [
			{
				id: 'first', sourceId: 'source', timelineStartFrame: 10, durationFrames: 20,
				sourceStartFrame: 50, sourceDurationFrames: 20,
			},
			{ id: 'second', sourceId: 'source', timelineStartFrame: 25, durationFrames: 10 },
		],
	};
	const crossfades = automaticCrossfadeRanges(project.clips);
	assert.deepEqual(crossfades.get('first')?.crossfadeOutRanges, [[15, 20]]);
	assert.deepEqual(crossfades.get('second')?.crossfadeInRanges, [[0, 5]]);

	const buffer = { length: 1_000, sampleRate: 100 } as AudioBuffer;
	const trackInput = {} as AudioNode;
	const plans = buildClipSchedulePlans({
		project,
		sources: new Map([['source', buffer]]),
		trackInputs: new Map([['track', trackInput]]),
		fromFrame: 15,
		toFrame: 25,
		sampleRate: 100,
	});
	assert.equal(plans.length, 1);
	assert.deepEqual({
		segmentStart: plans[0]?.segmentStart,
		segmentEnd: plans[0]?.segmentEnd,
		relativeStart: plans[0]?.relativeStart,
		offsetFrame: plans[0]?.offsetFrame,
		playbackRate: plans[0]?.playbackRate,
	}, {
		segmentStart: 15,
		segmentEnd: 25,
		relativeStart: 5,
		offsetFrame: 55,
		playbackRate: 1,
	});
});

test('schedule plans consume authored warp segments instead of a scalar clip rate', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		clips: [{
			id: 'clip', kind: 'audio', anchor: 'sample', sourceId: 'source',
			timelineStartFrame: 100, durationFrames: 100,
			sourceStartFrame: 1_000, sourceDurationFrames: 200,
			warpMap: {
				feature: 'audio-warp' as const,
				points: [
					{ outer: 0, source: 1_000, mode: 'forward' as const },
					{ outer: 50, source: 1_050, mode: 'forward' as const },
					{ outer: 100, source: 1_200, mode: 'forward' as const },
				],
			},
		}],
	};
	const plans = buildClipSchedulePlans({
		project,
		sources: new Map([['source', { length: 4_000, sampleRate: 96_000 } as AudioBuffer]]),
		trackInputs: new Map([['track', {} as AudioNode]]),
		fromFrame: 125,
		toFrame: 175,
		sampleRate: 48_000,
	});
	assert.deepEqual(plans.map((plan) => ({
		segmentStart: plan.segmentStart,
		segmentEnd: plan.segmentEnd,
		relativeStart: plan.relativeStart,
		offsetFrame: plan.offsetFrame,
		playbackRate: plan.playbackRate,
	})), [
		{ segmentStart: 125, segmentEnd: 150, relativeStart: 25, offsetFrame: 1_025, playbackRate: 0.5 },
		{ segmentStart: 150, segmentEnd: 175, relativeStart: 50, offsetFrame: 1_050, playbackRate: 1.5 },
	]);
});

test('rack and project graph latency remain additive across graph stages', () => {
	const limiter = (lookahead: number) => ({
		type: 'limiter',
		enabled: true,
		params: { lookahead },
	});
	assert.equal(effectRackLatencyFrames([limiter(0.01), { ...limiter(1), enabled: false }], 48_000), 480);
	assert.equal(projectGraphLatencyFrames({
		sampleRate: 48_000,
		tracks: [{ id: 'track', type: 'audio', effects: [limiter(0.01)] }],
		mixer: {
			groups: [{ id: 'group', effects: [limiter(0.002)] }],
			sends: [],
		},
		master: { effects: [limiter(0.001)] },
	}), 624);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyAudioTrackFreezeFreshnessV1,
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';

/**
 * A freeze is only reusable while everything that produced it is unchanged.
 *
 * Rack automation on the musical timebase is authored in beats and rendered in
 * samples, so the tempo map is one of the things that produced the frozen audio:
 * the scheduler resolves each point through the project's tempo map and adds a
 * breakpoint at every tempo event inside a segment. Two slices met here and
 * never agreed. The freeze digests hash the lane as authored, so a tempo edit
 * left every digest identical, the freeze reported `fresh`, and playback and
 * delivery kept serving audio whose automation followed the old tempo. Thawing
 * the track then changed the mix, which is the symptom that makes this hard to
 * attribute.
 *
 * The rule the digest now states: the tempo map belongs to the automation
 * digest exactly when a lane inside the freeze boundary reads it. A project
 * whose covered lanes are all sample-timebased is unaffected by a tempo edit
 * and must keep its freeze, or every tempo change would discard frozen renders
 * that are still correct.
 */

const SHA_A = 'a'.repeat(64);

const TEMPO_120 = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([Object.freeze({ beat: rational(0), bpm: rational(120) })]),
});
const TEMPO_140 = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([Object.freeze({ beat: rational(0), bpm: rational(140) })]),
});
const TEMPO_120_THEN_60 = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([
		Object.freeze({ beat: rational(0), bpm: rational(120) }),
		Object.freeze({ beat: rational(2), bpm: rational(60) }),
	]),
});

test('a tempo edit makes a freeze with musical rack automation stale', () => {
	const input = digestInput({ timebase: 'musical-beats' });
	const frozen = computeAudioTrackFreezeDigestsV1(input);
	const retempoed = computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: TEMPO_140 });

	assert.notEqual(
		retempoed.automationDigestSha256,
		frozen.automationDigestSha256,
		'a musical lane resolves to different samples under a different tempo',
	);
	assert.equal(retempoed.inputDigestSha256, frozen.inputDigestSha256);
	assert.equal(retempoed.rackDigestSha256, frozen.rackDigestSha256);
	assert.deepEqual(
		classifyAudioTrackFreezeFreshnessV1(freezeRecord(frozen), retempoed),
		{ status: 'stale', changedComponents: ['automation', 'freshness'] },
	);
});

test('a tempo event inside an automated segment is not hidden by unchanged endpoints', () => {
	const input = digestInput({ timebase: 'musical-beats' });
	const frozen = computeAudioTrackFreezeDigestsV1(input);
	const interior = computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: TEMPO_120_THEN_60 });

	assert.notEqual(interior.automationDigestSha256, frozen.automationDigestSha256);
	assert.equal(
		classifyAudioTrackFreezeFreshnessV1(freezeRecord(frozen), interior).status,
		'stale',
	);
});

test('a tempo edit keeps a freeze whose covered automation is sample-timebased', () => {
	const input = digestInput({ timebase: 'absolute-samples' });
	const frozen = computeAudioTrackFreezeDigestsV1(input);
	const retempoed = computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: TEMPO_140 });

	assert.deepEqual(retempoed, frozen, 'a sample-timebased render does not read the tempo map');
	assert.equal(
		classifyAudioTrackFreezeFreshnessV1(freezeRecord(frozen), retempoed).status,
		'fresh',
	);
});

test('a tempo edit makes a freeze with a musically anchored clip stale', () => {
	// The render resolves anchor:'musical' clips to timeline frames through the
	// tempo map, so the map is freeze input even when no covered lane reads it.
	const input = musicalClipInput();
	const frozen = computeAudioTrackFreezeDigestsV1(input);
	const retempoed = computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: TEMPO_140 });

	assert.notEqual(
		retempoed.freshnessDigestSha256,
		frozen.freshnessDigestSha256,
		'a musically anchored clip lands on different frames under a different tempo',
	);
	assert.equal(
		classifyAudioTrackFreezeFreshnessV1(freezeRecord(frozen), retempoed).status,
		'stale',
	);
});

test('a musically anchored clip requires the tempo map that places it', () => {
	const input = musicalClipInput();
	assert.throws(
		() => computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: null }),
		/tempo map/iu,
	);
});

test('a musical lane outside the freeze boundary leaves the tempo map out of the digest', () => {
	const covered = digestInput({ timebase: 'absolute-samples' });
	const uncovered = {
		...covered,
		automationLanes: [
			...covered.automationLanes,
			lane('lane-other-track', 'musical-beats', {
				kind: 'effect', strip: { kind: 'track', id: 'track-b' },
				effectId: 'fx-b', parameterId: 'amount',
			}),
		],
	};
	const frozen = computeAudioTrackFreezeDigestsV1(uncovered);
	const retempoed = computeAudioTrackFreezeDigestsV1({ ...uncovered, tempoMap: TEMPO_140 });

	assert.deepEqual(retempoed, frozen);
	assert.deepEqual(frozen, computeAudioTrackFreezeDigestsV1(covered));
});

test('a musical lane inside the freeze boundary requires the tempo map that renders it', () => {
	const input = digestInput({ timebase: 'musical-beats' });
	assert.throws(
		() => computeAudioTrackFreezeDigestsV1({ ...input, tempoMap: null }),
		/tempo map/iu,
	);
});

function digestInput(options: Readonly<{ timebase: 'absolute-samples' | 'musical-beats' }>) {
	return {
		sampleRate: 48_000,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		track: {
			type: 'audio', id: 'track-a', clipIds: ['clip-a'],
			gain: 1, pan: 0, mute: false, solo: false,
			effectsActive: true,
			effects: [{ id: 'fx-a', type: 'limiter', enabled: true, params: { threshold: -1 } }],
		},
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 1_024, durationFrames: 1_024,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, envelope: [],
			opaqueExtensions: {},
		}],
		sourceContentIdentities: [{ sourceId: 'source-a', contentSha256: SHA_A }],
		automationLanes: [lane('lane-effect', options.timebase, {
			kind: 'effect', strip: { kind: 'track', id: 'track-a' },
			effectId: 'fx-a', parameterId: 'threshold',
		})],
		tempoMap: TEMPO_120,
	};
}

function musicalClipInput() {
	const base = digestInput({ timebase: 'absolute-samples' });
	return {
		...base,
		clips: [{
			...base.clips[0],
			anchor: 'musical',
			musicalStartBeat: rational(4),
			musicalExtent: 'fixedSamples',
		}],
	};
}

function lane(
	id: string,
	timebase: 'absolute-samples' | 'musical-beats',
	address: Readonly<Record<string, unknown>>,
) {
	const positions = timebase === 'musical-beats'
		? [rational(0), rational(4)]
		: [0, 96_000];
	return {
		id,
		address,
		timebase,
		points: [
			{ id: `${id}-start`, position: positions[0], value: 0.25 },
			{ id: `${id}-end`, position: positions[1], value: 0.75 },
		],
		segments: [{ kind: 'linear' }],
	};
}

function freezeRecord(digests: Readonly<{
	readonly inputDigestSha256: string;
	readonly rackDigestSha256: string;
	readonly automationDigestSha256: string;
	readonly freshnessDigestSha256: string;
}>): AudioTrackFreezeV1 {
	return {
		schemaVersion: 1,
		derivedSourceId: 'derived-a',
		...digests,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
}

function rational(value: number) {
	return { num: value, den: 1 };
}


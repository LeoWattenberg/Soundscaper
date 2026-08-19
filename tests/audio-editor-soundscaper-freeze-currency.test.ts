/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioTrackFreezeRenderFingerprintV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';

/**
 * What counts as "the document changed" while a freeze is running.
 *
 * A freeze runs for as long as the audio takes, and it asks after every awaited
 * step whether the document it started against still says the same thing. That
 * question used to be answered by object identity — but every command publishes
 * a new document, so clicking the timeline to move the selection aborted an
 * in-flight freeze and rolled the work back, though nothing the render reads had
 * moved. A long freeze could not survive an idle click.
 *
 * The fingerprint states the render's own inputs instead: clip ownership, the
 * clips, the media identity under them, the insert rack, the rack automation,
 * and the tempo map a musical lane resolves through. Live strip controls are
 * outside the freeze boundary, so a fader move is not a reason to discard a
 * render, and an edit to the material still is.
 */

const SHA_A = 'a'.repeat(64);

test('a selection or fader change leaves the render fingerprint alone', () => {
	const base = fingerprintInput();
	const first = audioTrackFreezeRenderFingerprintV1(base);

	// Live strip controls are outside the freeze boundary; the render is
	// explicitly pre-strip and mute/solo-blind.
	assert.equal(audioTrackFreezeRenderFingerprintV1({
		...base,
		track: { ...base.track, gain: 0.25, pan: 0.5, mute: true, solo: true },
	}), first);
});

test('an edit to what the render reads moves the fingerprint', () => {
	const base = fingerprintInput();
	const first = audioTrackFreezeRenderFingerprintV1(base);

	assert.notEqual(audioTrackFreezeRenderFingerprintV1({
		...base,
		clips: base.clips.map((clip) => ({ ...clip, gain: 0.5 })),
	}), first, 'a clip edit changes the render');
	assert.notEqual(audioTrackFreezeRenderFingerprintV1({
		...base,
		track: {
			...base.track,
			effects: [{ id: 'fx-a', type: 'limiter', enabled: true, params: { threshold: -6 } }],
		},
	}), first, 'a rack edit changes the render');
	assert.notEqual(audioTrackFreezeRenderFingerprintV1({
		...base,
		automationLanes: base.automationLanes.map((lane) => ({
			...lane,
			points: [{ id: 'lane-effect-start', position: 0, value: 0.9 }],
		})),
	}), first, 'rack automation changes the render');
	assert.notEqual(audioTrackFreezeRenderFingerprintV1({
		...base,
		sourceContentIdentities: [{ sourceId: 'source-a', contentSha256: 'b'.repeat(64) }],
	}), first, 'different media under the clip changes the render');
});

test('a musical rack lane binds the tempo map that resolves it', () => {
	const musical = {
		...fingerprintInput(),
		automationLanes: [{
			id: 'lane-effect',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'track-a' },
				effectId: 'fx-a', parameterId: 'threshold',
			},
			timebase: 'musical-beats',
			points: [{ id: 'lane-effect-start', position: { num: 0, den: 1 }, value: 0.5 }],
			segments: [],
		}],
		tempoMap: tempoMap(120),
	};
	assert.notEqual(
		audioTrackFreezeRenderFingerprintV1({ ...musical, tempoMap: tempoMap(140) }),
		audioTrackFreezeRenderFingerprintV1(musical),
	);
});

function fingerprintInput() {
	return {
		sampleRate: 48_000,
		track: {
			type: 'audio', id: 'track-a', clipIds: ['clip-a'],
			gain: 1, pan: 0, mute: false, solo: false,
			effectsActive: true,
			effects: [{ id: 'fx-a', type: 'limiter', enabled: true, params: { threshold: -1 } }],
		},
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 1_024, durationFrames: 1_024,
			gain: 1, fadeInFrames: 0, fadeOutFrames: 0, envelope: [], opaqueExtensions: {},
		}],
		sourceContentIdentities: [{ sourceId: 'source-a', contentSha256: SHA_A }],
		automationLanes: [{
			id: 'lane-effect',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'track-a' },
				effectId: 'fx-a', parameterId: 'threshold',
			},
			timebase: 'absolute-samples',
			points: [{ id: 'lane-effect-start', position: 0, value: 0.5 }],
			segments: [],
		}],
		tempoMap: null,
	};
}

function tempoMap(bpm: number) {
	return {
		mode: 'musical',
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: bpm, den: 1 } }],
	};
}

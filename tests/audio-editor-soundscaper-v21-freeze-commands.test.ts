/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import {
	createSoundscaperProjectHistoryV21,
	executeSoundscaperProjectCommandV21,
	undoSoundscaperProjectCommandV21,
} from '../src/soundscaper/editor-project-v21-history.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const LIVE_DIGEST = 'ab'.repeat(32);
const DERIVED_DIGEST = 'cd'.repeat(32);
const NOW = '2026-08-14T13:00:00.000Z';

test('freeze install/remove commands reconcile exact fallback state and survive inherited edits/history', () => {
	const { project, freeze, digests, derivedSource, sourceContentIdentities } = fixture();
	const installed = applySoundscaperProjectCommandV21(project, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	}, { now: NOW });
	assert.deepEqual(track(installed).audioFreeze, freeze);
	assert.equal(installed.sources.some(({ id }) => id === 'voice-freeze'), true);
	assert.equal(freezeRequirements(installed).length, 1);
	assert.equal(installed.sources.find(({ id }) => id === 'voice-live')?.contentSha256, LIVE_DIGEST);
	assert.equal(freezeRequirements(installed)[0]?.disposition, 'rendered-fallback');

	const stale = applySoundscaperProjectCommandV21(installed, {
		type: 'effect/add', scope: 'track', trackId: 'voice',
		effect: { id: 'post-freeze-highpass', type: 'highpass', enabled: true, params: {} },
	});
	assert.equal(freezeRequirements(stale)[0]?.disposition, 'bypass');
	assert.equal(freezeRequirements(stale)[0]?.fallback, null);

	const renamed = applySoundscaperProjectCommandV21(installed, {
		type: 'project/rename', title: 'Renamed while frozen',
	});
	assert.deepEqual(track(renamed).audioFreeze, freeze);
	assert.equal(freezeRequirements(renamed).length, 1);
	assert.throws(() => applySoundscaperProjectCommandV21(renamed, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	}), /expected|changed|stale/iu);

	const history = createSoundscaperProjectHistoryV21(renamed);
	const removed = executeSoundscaperProjectCommandV21(history, {
		type: 'audio-freeze/remove', trackId: 'voice', expectedFreeze: freeze,
	});
	assert.equal(Object.hasOwn(track(removed.present), 'audioFreeze'), false);
	assert.equal(removed.present.sources.some(({ id }) => id === 'voice-freeze'), false);
	assert.deepEqual(freezeRequirements(removed.present), []);
	const restored = undoSoundscaperProjectCommandV21(removed);
	assert.deepEqual(track(restored.present).audioFreeze, freeze);
	assert.equal(restored.present.sources.some(({ id }) => id === 'voice-freeze'), true);
	assert.equal(freezeRequirements(restored.present).length, 1);
	assert.deepEqual(digests, {
		inputDigestSha256: freeze.inputDigestSha256,
		rackDigestSha256: freeze.rackDigestSha256,
		automationDigestSha256: freeze.automationDigestSha256,
		freshnessDigestSha256: freeze.freshnessDigestSha256,
	});
});

test('freeze commit is one undoable bake retaining strip/routing and retiring effect authority', () => {
	const { project, freeze, digests, derivedSource, sourceContentIdentities } = fixture();
	const initial = createSoundscaperProjectHistoryV21(project);
	const installed = executeSoundscaperProjectCommandV21(initial, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	});
	const before = installed.present;
	const committed = executeSoundscaperProjectCommandV21(installed, {
		type: 'audio-freeze/commit',
		trackId: 'voice', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: DERIVED_DIGEST,
		derivedClip: committedClip(),
	});
	const afterTrack = track(committed.present);
	const beforeTrack = track(before);
	for (const key of ['id', 'name', 'gain', 'pan', 'mute', 'solo', 'laneGroupId']) {
		assert.equal(afterTrack[key], beforeTrack[key]);
	}
	assert.deepEqual(afterTrack.clipIds, ['voice-committed']);
	assert.deepEqual(afterTrack.effects, []);
	assert.equal(Object.hasOwn(afterTrack, 'audioFreeze'), false);
	assert.deepEqual(committed.present.automationLanes.map(({ id }) => id), ['voice-gain']);
	assert.deepEqual(committed.present.mixer, before.mixer);
	assert.deepEqual(freezeRequirements(committed.present), []);
	assert.equal(committed.present.sources.some(({ id }) => id === 'voice-live'), false);
	assert.equal(committed.present.sources.some(({ id }) => id === 'voice-freeze'), true);

	const undone = undoSoundscaperProjectCommandV21(committed);
	assert.deepEqual(track(undone.present).audioFreeze, freeze);
	assert.equal(undone.present.sources.some(({ id }) => id === 'voice-live'), true);
	assert.equal(undone.present.sources.some(({ id }) => id === 'voice-freeze'), true);
	assert.equal(freezeRequirements(undone.present).length, 1);
});

function fixture() {
	const liveSource = createAudioSourceV10({
		id: 'voice-live', storageKey: 'pcm:voice-live', frameCount: 512,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const liveClip = createAudioClipV10({
		id: 'voice-clip', sourceId: 'voice-live', title: 'Voice', timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const voiceEffect = {
		id: 'voice-fx', type: 'limiter', enabled: true,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	};
	const automationEffect = {
		id: 'voice-filter', type: 'highpass', enabled: true,
		params: { frequency: 1_000, q: 1 },
	};
	const effectLane = {
		id: 'voice-frequency',
		address: {
			kind: 'effect', strip: { kind: 'track', id: 'voice' },
			effectId: 'voice-filter', parameterId: 'frequency',
		},
		timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1_000 }], segments: [],
	};
	const stripLane = {
		id: 'voice-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 0.8 }], segments: [],
	};
	const voiceTrack = createAudioTrackV10({
		id: 'voice', name: 'Voice', gain: 0.8, pan: -0.2, clipIds: ['voice-clip'],
		effects: [voiceEffect, automationEffect],
	});
	const project = createSoundscaperProjectV21({
		id: 'freeze-command-project', title: 'Freeze command project', now: NOW,
		sources: [liveSource], clips: [liveClip], tracks: [voiceTrack],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }], primarySequenceId: 'main-sequence',
		automationLanes: [effectLane, stripLane],
	});
	const sourceContentIdentities = Object.freeze([
		Object.freeze({ sourceId: 'voice-live', contentSha256: LIVE_DIGEST }),
	]);
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: project.sampleRate,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		track: project.tracks[0],
		clips: project.clips,
		sourceContentIdentities,
		automationLanes: project.automationLanes,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1, derivedSourceId: 'voice-freeze', ...digests,
		renderStartFrame: 0, renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
	const derivedSource = createAudioSourceV10({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_DIGEST,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	return { project, freeze, digests, derivedSource, sourceContentIdentities };
}

function committedClip(): Readonly<Record<string, unknown>> {
	return createAudioClipV10({
		id: 'voice-committed', sourceId: 'voice-freeze', title: 'Voice committed',
		anchor: 'sample', timelineStartFrame: 0, durationFrames: 1_024,
		sourceStartFrame: 0, sourceDurationFrames: 1_024,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		reversed: false, envelope: [], pitchCents: 0, speedRatio: 1,
	});
}

function track(project: Readonly<Record<string, unknown>>): Record<string, unknown> {
	return (project.tracks as readonly Record<string, unknown>[]).find(({ id }) => id === 'voice')!;
}

function freezeRequirements(project: Readonly<Record<string, unknown>>) {
	return (project.featureRequirements as {
		readonly requirements: readonly Readonly<Record<string, unknown>>[];
	}).requirements.filter(({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
}

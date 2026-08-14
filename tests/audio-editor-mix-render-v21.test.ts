/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createMixRenderSnapshot,
	prepareMixRenderCommit,
} from '../src/common/editor/controller/mix-render-model.ts';
import type {
	ControllerProject,
	ControllerSource,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';
import { validateMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T12:00:00.000Z';

test('V21 mix snapshots retain exact graph authority and never create legacy routes or envelopes', () => {
	const project = fixture();
	const tracks = project.tracks.filter(({ type }) => type === 'audio') as unknown as readonly ControllerTrack[];
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, tracks);
	const mixer = snapshot.mixer as unknown as typeof project.mixer;
	assert.equal(snapshot.schemaVersion, 21);
	assert.equal(Object.hasOwn(mixer, 'routes'), false);
	assert.equal(Object.hasOwn(snapshot.tracks[0]!, 'envelope'), false);
	assert.equal(validateMixerGraphV21(mixer, {
		audioTracks: snapshot.tracks.map(({ id, effects }) => ({ id, effects })),
		masterEffects: (project.master as { readonly effects: readonly { readonly id?: unknown }[] }).effects,
		masterChannels: project.masterChannels,
	}), true);
	assert.deepEqual(
		(snapshot as unknown as { automationLanes: readonly { id: string }[] }).automationLanes.map(({ id }) => id),
		['voice-gain', 'music-gain'],
	);
	assert.equal(Object.hasOwn(project.mixer, 'routes'), false);
});

test('single-track V21 mix uses a closed direct graph and removes baked strip automation on commit', () => {
	const project = fixture();
	const voice = project.tracks.find(({ id }) => id === 'voice') as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(
		project as unknown as ControllerProject,
		[voice],
	) as unknown as { mixer: typeof project.mixer; automationLanes: readonly { id: string }[] };
	assert.deepEqual(snapshot.mixer.groups, []);
	assert.deepEqual(snapshot.mixer.sends, []);
	assert.deepEqual(snapshot.automationLanes.map(({ id }) => id), ['voice-gain']);

	const prepared = prepareMixRenderCommit(
		project as unknown as ControllerProject,
		[voice],
		derivedSource(),
		{ startFrame: 0, mixName: 'Voice', createId: (prefix) => `${prefix}-mixed` },
	);
	const laneRemoval = prepared.command.commands.find(({ type }) => type === 'automation-lane/set');
	assert.equal(laneRemoval?.type, 'automation-lane/set');
	const trackUpdate = prepared.command.commands.find(({ type }) => type === 'track/update');
	assert.equal(trackUpdate?.type, 'track/update');
	if (trackUpdate?.type !== 'track/update') assert.fail('Expected the mixed track reset command.');
	assert.equal(Object.hasOwn(trackUpdate.changes, 'envelope'), false);
});

function fixture() {
	const voiceSource = source('voice-source');
	const musicSource = source('music-source');
	const voiceClip = clip('voice-clip', 'voice-source');
	const musicClip = clip('music-clip', 'music-source');
	return createSoundscaperProjectV21({
		id: 'mix-v21', title: 'Mix V21', now: NOW,
		sources: [voiceSource, musicSource],
		clips: [voiceClip, musicClip],
		tracks: [
			createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrackV10({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [lane('voice-gain', 'voice'), lane('music-gain', 'music')],
	});
}

function source(id: string) {
	return createAudioSourceV10({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount: 100, sampleRate: 48_000, channelCount: 1,
	});
}

function clip(id: string, sourceId: string) {
	return createAudioClipV10({
		id, sourceId, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 100, sourceDurationFrames: 100,
	});
}

function lane(id: string, trackId: string) {
	return {
		id,
		address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [{ id: `${id}-start`, position: 0, value: 1 }],
		segments: [],
	} as const;
}

function derivedSource(): ControllerSource {
	return {
		id: 'mixed-source', storageKey: 'mixed-source', name: 'Mixed', mimeType: 'audio/wav',
		frameCount: 100, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	};
}

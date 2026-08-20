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
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
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
	assert.equal((snapshot.master as { readonly effects: readonly unknown[] }).effects.length, 1);
	assert.equal(mixer.edges.some(({ id }) => id === 'voice-master-sidechain'), false);
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

test('a V21 mix snapshot of a foldered project is one the engine will load', async () => {
	// The snapshot narrows tracks to the mix targets while keeping the authored
	// folders and sequence nodes, so it has to carry the folder projection: the
	// pre-production sibling has always done this, and without it the engine
	// rejects a hierarchy that names tracks the snapshot dropped.
	const project = folderedFixture();
	const voice = project.tracks.find(({ id }) => id === 'voice') as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [voice]);
	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['voice']);
	// The folder muted its children; the mix of that track is still rendered,
	// exactly as an unfoldered muted track's mix is.
	assert.equal((snapshot.tracks[0] as unknown as Record<string, unknown>).mute, false);

	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	try {
		assert.doesNotThrow(() => { engine.loadProject(snapshot as never, new Map()); });
	} finally {
		await engine.dispose();
	}
});

function folderedFixture() {
	return createSoundscaperProjectV21({
		id: 'mix-v21-folders', title: 'Mix V21 folders', now: NOW,
		sources: [source('voice-source'), source('music-source')],
		clips: [clip('voice-clip', 'voice-source'), clip('music-clip', 'music-source')],
		tracks: [
			createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrackV10({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
		],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main-sequence',
	});
}

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
		master: {
			effectsActive: true,
			effects: [{ id: 'master-filter', type: 'highpass', enabled: true, params: { frequency: 200 } }],
		},
		mixer: {
			schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				routingEdge('voice-master', 'assignment', { kind: 'track', id: 'voice' }, { kind: 'master' }),
				routingEdge('music-master', 'assignment', { kind: 'track', id: 'music' }, { kind: 'master' }),
				routingEdge('voice-master-sidechain', 'sidechain', { kind: 'track', id: 'voice' }, {
					kind: 'effect-sidechain', strip: { kind: 'master' }, effectId: 'master-filter',
				}),
				routingEdge('master-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [
			lane('voice-gain', 'voice'),
			lane('music-gain', 'music'),
			{
				id: 'master-frequency',
				address: {
					kind: 'effect', strip: { kind: 'master' },
					effectId: 'master-filter', parameterId: 'frequency',
				},
				timebase: 'absolute-samples',
				points: [{ id: 'master-frequency-start', position: 0, value: 200 }],
				segments: [],
			},
			{
				id: 'master-sidechain-level',
				address: { kind: 'edge', edgeId: 'voice-master-sidechain', parameterId: 'level' },
				timebase: 'absolute-samples',
				points: [{ id: 'master-sidechain-level-start', position: 0, value: 1 }],
				segments: [],
			},
		],
	});
}

function routingEdge(id: string, kind: string, source: unknown, destination: unknown) {
	return {
		id, kind, source, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [],
	};
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

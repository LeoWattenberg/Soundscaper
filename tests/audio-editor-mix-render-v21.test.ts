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
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

const NOW = '2026-08-14T12:00:00.000Z';

test('V21 mix snapshots retain exact graph authority and never create legacy routes or envelopes', () => {
	const project = fixture();
	const tracks = project.tracks.filter(({ type }) => type === 'audio') as unknown as readonly ControllerTrack[];
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, tracks);
	const mixer = snapshot.mixer as unknown as typeof project.mixer;
	assert.equal(snapshot.schemaVersion, 1);
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
	assert.equal((snapshot.master as { readonly effects: readonly unknown[] }).effects.length, 2);
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

test('V21 mix retains an unselected Auto Duck control track and sidechain', async () => {
	const project = autoDuckFixture();
	const voice = project.tracks.find(({ id }) => id === 'voice') as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [voice]);
	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['voice', 'music']);
	assert.equal((snapshot.mixer as unknown as typeof project.mixer).edges
		.some(({ id }) => id === 'music-voice-duck'), true);
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	try {
		assert.doesNotThrow(() => { engine.loadProject(snapshot as never, new Map()); });
	} finally {
		await engine.dispose();
	}
});

test('V21 combined mix retains Auto Duck controls only for relevant group and send racks', () => {
	for (const host of ['master', 'group', 'send', 'cue'] as const) {
		const project = hostedAutoDuckFixture(host);
		const targets = project.tracks
			.filter(({ id }) => id === 'voice' || id === 'fx') as unknown as readonly ControllerTrack[];
		const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, targets);
		const expected = host === 'group' || host === 'send';
		assert.equal(snapshot.tracks.some(({ id }) => id === 'music'), expected, host);
		assert.equal((snapshot.mixer as unknown as typeof project.mixer).edges
			.some(({ id }) => id === `music-${host}-duck`), expected, host);
		assert.equal(validateSoundscaperProject(snapshot), true, host);
	}
});

test('V21 mix snapshots reconcile owned requirements after pruning master-only automation', () => {
	for (const project of [singleTrackMasterAutomationFixture(), fixture(false)]) {
		const targets = project.tracks.filter(({ type }) => type === 'audio') as unknown as readonly ControllerTrack[];
		const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, targets);
		assert.deepEqual(
			(snapshot as unknown as { automationLanes: readonly unknown[] }).automationLanes,
			[],
		);
		assert.equal(validateSoundscaperProject(snapshot), true);
	}
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
	return createSoundscaperProject({
		id: 'mix-v21-folders', title: 'Mix V21 folders', now: NOW,
		sources: [source('voice-source'), source('music-source')],
		clips: [clip('voice-clip', 'voice-source'), clip('music-clip', 'music-source')],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
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

function fixture(includeTrackAutomation = true) {
	const voiceSource = source('voice-source');
	const musicSource = source('music-source');
	const voiceClip = clip('voice-clip', 'voice-source');
	const musicClip = clip('music-clip', 'music-source');
	return createSoundscaperProject({
		id: 'mix-v21', title: 'Mix V21', now: NOW,
		sources: [voiceSource, musicSource],
		clips: [voiceClip, musicClip],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
		master: {
			effectsActive: true,
			effects: [
				{ id: 'master-filter', type: 'highpass', enabled: true, params: { frequency: 200 } },
				{ id: 'master-gate', type: 'gate', enabled: true, params: { threshold: -30 } },
			],
		},
		mixer: {
			schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				routingEdge('voice-master', 'assignment', { kind: 'track', id: 'voice' }, { kind: 'master' }),
				routingEdge('music-master', 'assignment', { kind: 'track', id: 'music' }, { kind: 'master' }),
				routingEdge('voice-master-sidechain', 'sidechain', { kind: 'track', id: 'voice' }, {
					kind: 'effect-sidechain', strip: { kind: 'master' }, effectId: 'master-gate',
				}),
				routingEdge('master-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [
			...(includeTrackAutomation ? [lane('voice-gain', 'voice'), lane('music-gain', 'music')] : []),
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

function singleTrackMasterAutomationFixture() {
	return createSoundscaperProject({
		id: 'mix-v21-single', title: 'Single V21 mix', now: NOW,
		sources: [source('voice-source')],
		clips: [clip('voice-clip', 'voice-source')],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		master: {
			effectsActive: true,
			effects: [{ id: 'master-filter', type: 'highpass', enabled: true, params: { frequency: 200 } }],
		},
		automationLanes: [{
			id: 'master-frequency',
			address: {
				kind: 'effect', strip: { kind: 'master' },
				effectId: 'master-filter', parameterId: 'frequency',
			},
			timebase: 'absolute-samples',
			points: [{ id: 'master-frequency-start', position: 0, value: 200 }],
			segments: [],
		}],
	});
}

function autoDuckFixture() {
	const project = fixture();
	return createSoundscaperProject({
		...project,
		tracks: project.tracks.map((track) => track.id === 'voice' ? {
			...track,
			effectsActive: true,
			effects: [{ id: 'voice-duck', type: 'audacity-auto-duck', enabled: true,
				params: {}, context: { controlTrackId: 'music' } }],
		} : track),
		mixer: { ...project.mixer, edges: [...project.mixer.edges,
			routingEdge('music-voice-duck', 'sidechain', { kind: 'track', id: 'music' }, {
				kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'voice-duck',
			})] },
	} as never);
}

function hostedAutoDuckFixture(host: 'master' | 'group' | 'send' | 'cue') {
	const duck = { id: `${host}-duck`, type: 'audacity-auto-duck', enabled: true, params: {} };
	const node = {
		id: `${host}-node`, name: `${host} node`, color: '#808080', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [duck],
		channelCount: 2,
	};
	const destination = host === 'master'
		? { kind: 'master' as const }
		: { kind: 'mixer-node' as const, id: node.id };
	return createSoundscaperProject({
		id: `mix-v21-${host}-duck`, title: `${host} Auto Duck`, now: NOW,
		sources: [source('voice-source'), source('fx-source'), source('music-source')],
		clips: [
			clip('voice-clip', 'voice-source'), clip('fx-clip', 'fx-source'),
			clip('music-clip', 'music-source'),
		],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] }),
			createAudioTrack({ id: 'fx', name: 'FX', clipIds: ['fx-clip'] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'fx', 'music'] }],
		primarySequenceId: 'main-sequence',
		master: host === 'master' ? { effectsActive: true, effects: [duck] } : undefined,
		mixer: {
			schemaVersion: 1,
			groups: host === 'group' ? [node] : [],
			sends: host === 'send' ? [node] : [],
			cues: host === 'cue' ? [node] : [],
			vcas: [], outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				routingEdge('voice-master', 'assignment', { kind: 'track', id: 'voice' }, { kind: 'master' }),
				routingEdge('fx-master', 'assignment', { kind: 'track', id: 'fx' }, { kind: 'master' }),
				routingEdge('music-master', 'assignment', { kind: 'track', id: 'music' }, { kind: 'master' }),
				...(host === 'group' || host === 'send' ? [
					routingEdge(`voice-${host}`, host === 'send' ? 'send' : 'assignment',
						{ kind: 'track', id: 'voice' }, { kind: 'mixer-node', id: node.id }),
					routingEdge(`${host}-master`, 'assignment',
						{ kind: 'mixer-node', id: node.id }, { kind: 'master' }),
				] : []),
				routingEdge(`music-${host}-duck`, 'sidechain', { kind: 'track', id: 'music' }, {
					kind: 'effect-sidechain', strip: destination, effectId: duck.id,
				}),
				routingEdge('master-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
	} as never);
}

function routingEdge(id: string, kind: string, source: unknown, destination: unknown) {
	return {
		id, kind, source, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [],
	};
}

function source(id: string) {
	return createAudioSource({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount: 100, sampleRate: 48_000, channelCount: 1,
	});
}

function clip(id: string, sourceId: string) {
	return createAudioClip({
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

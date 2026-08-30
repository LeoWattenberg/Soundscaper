/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { resolveTerminalChannelWidths } from '../src/common/editor/terminal-channel-widths.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const LIVE_DIGEST = 'ab'.repeat(32);
const DERIVED_DIGEST = 'cd'.repeat(32);
const NOW = '2026-08-14T13:00:00.000Z';

test('freeze install/remove commands reconcile exact fallback state and survive inherited edits/history', () => {
	const { project, freeze, digests, derivedSource, sourceContentIdentities } = fixture();
	const installed = applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	}, { now: NOW });
	assert.deepEqual(track(installed).audioFreeze, freeze);
	assert.equal(installed.sources.some(({ id }) => id === 'voice-freeze'), true);
	assert.equal(freezeRequirements(installed).length, 1);
	assert.equal(installed.sources.find(({ id }) => id === 'voice-live')?.contentSha256, LIVE_DIGEST);
	assert.equal(freezeRequirements(installed)[0]?.disposition, 'rendered-fallback');

	const stale = applySoundscaperProjectCommand(installed, {
		type: 'effect/add', scope: 'track', trackId: 'voice',
		effect: { id: 'post-freeze-highpass', type: 'highpass', enabled: true, params: {} },
	});
	assert.equal(freezeRequirements(stale)[0]?.disposition, 'bypass');
	assert.equal(freezeRequirements(stale)[0]?.fallback, null);

	const renamed = applySoundscaperProjectCommand(installed, {
		type: 'project/rename', title: 'Renamed while frozen',
	});
	assert.deepEqual(track(renamed).audioFreeze, freeze);
	assert.equal(freezeRequirements(renamed).length, 1);
	assert.throws(() => applySoundscaperProjectCommand(renamed, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	}), /expected|changed|stale/iu);

	const history = createSoundscaperProjectHistory(renamed);
	const removed = executeSoundscaperProjectCommand(history, {
		type: 'audio-freeze/remove', trackId: 'voice', expectedFreeze: freeze,
	});
	assert.equal(Object.hasOwn(track(removed.present), 'audioFreeze'), false);
	assert.equal(removed.present.sources.some(({ id }) => id === 'voice-freeze'), false);
	assert.deepEqual(freezeRequirements(removed.present), []);
	const restored = undoSoundscaperProjectCommand(removed);
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
	const initial = createSoundscaperProjectHistory(project);
	const installed = executeSoundscaperProjectCommand(initial, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	});
	const before = installed.present;
	const committed = executeSoundscaperProjectCommand(installed, {
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

	const undone = undoSoundscaperProjectCommand(committed);
	assert.deepEqual(track(undone.present).audioFreeze, freeze);
	assert.equal(undone.present.sources.some(({ id }) => id === 'voice-live'), true);
	assert.equal(undone.present.sources.some(({ id }) => id === 'voice-freeze'), true);
	assert.equal(freezeRequirements(undone.present).length, 1);
});

test('a frozen track can be deleted, and its editable clips stay required until it is', () => {
	const { project, freeze, derivedSource, sourceContentIdentities } = fixture();
	const installed = applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	} as never, { now: NOW });

	// The freeze requirement names the frozen track, and it used to be renormalized
	// against the post-command document before it could be re-derived, so removing the
	// track was rejected for a fallback target the same command had just deleted.
	const removed = applySoundscaperProjectCommand(installed, {
		type: 'track/remove', trackId: 'voice',
	} as never);
	assert.deepEqual(removed.tracks.map(({ id }) => id), []);
	assert.equal(freezeRequirements(removed).length, 0);

	// Retaining the editable material is the freeze contract, so emptying the track is
	// still refused - but by the invariant that owns it, not by requirement ordering.
	assert.throws(() => applySoundscaperProjectCommand(installed, {
		type: 'clip/remove-many', clipIds: ['voice-clip'], rippleMode: 'none',
	} as never), /must retain editable clips/iu);
});

test('committing a freeze drops lanes addressed to the sidechain edges it removes', () => {
	const { project, freeze, digests, derivedSource, sourceContentIdentities } = fixture();
	// A sidechain into the frozen track's rack, and a lane addressing that edge. Both
	// are first-class: the routing editor authors sidechain edges and lanes may address
	// an edge as well as an effect.
	const sourced = applySoundscaperProjectCommand(project, {
		type: 'track/add', track: createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
	} as never);
	const sidechainId = 'sidechain:duck:voice:voice-fx';
	const withSidechain = applySoundscaperProjectCommand(sourced, {
		type: 'mixer-graph/set',
		expected: sourced.mixer,
		mixer: {
			...sourced.mixer,
			edges: [...sourced.mixer.edges, {
				id: sidechainId, kind: 'sidechain',
				source: { kind: 'track', id: 'music' },
				destination: {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'voice-fx',
				},
				position: 'post-fader', level: 1, enabled: true, channelMap: [],
			}],
		},
	} as never);
	const withLane = applySoundscaperProjectCommand(withSidechain, {
		type: 'automation-lane/set',
		laneId: 'sidechain-level',
		expected: null,
		lane: {
			id: 'sidechain-level',
			address: { kind: 'edge', edgeId: sidechainId, parameterId: 'level' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 1 }],
			segments: [],
		},
	} as never);
	assert.equal(withLane.automationLanes.some(({ id }) => id === 'sidechain-level'), true);

	const installed = applySoundscaperProjectCommand(withLane, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	} as never, { now: NOW });
	// Commit removes the rack sidechain edges, so the lane addressing one has to go
	// with them; leaving it dangling used to make the whole command fail validation.
	const committed = applySoundscaperProjectCommand(installed, {
		type: 'audio-freeze/commit',
		trackId: 'voice', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: DERIVED_DIGEST,
		derivedClip: committedClip(),
	} as never);
	assert.equal(committed.mixer.edges.some(({ id }) => id === sidechainId), false);
	assert.equal(committed.automationLanes.some(({ id }) => id === 'sidechain-level'), false);
});

test('an enabled sidechain cannot be authored into an already frozen rack', () => {
	const { project, freeze, derivedSource, sourceContentIdentities } = fixture();
	const installed = applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	} as never, { now: NOW });
	const sourced = applySoundscaperProjectCommand(installed, {
		type: 'track/add', track: createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
	} as never);

	assert.throws(() => applySoundscaperProjectCommand(sourced, {
		type: 'mixer-graph/set',
		expected: sourced.mixer,
		mixer: {
			...sourced.mixer,
			edges: [...sourced.mixer.edges, {
				id: 'sidechain:duck:voice:voice-fx', kind: 'sidechain',
				source: { kind: 'track', id: 'music' },
				destination: {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'voice-fx',
				},
				position: 'post-fader', level: 1, enabled: true, channelMap: [],
			}],
		},
	} as never), /cannot route a sidechain into frozen track voice/iu);
});

test('a freeze cannot narrow a track underneath the channel maps already aimed at it', () => {
	// A 5.1 stem in a stereo delivery, routed through a 6-wide bus. The offline renderer
	// used to size its output from masterChannels, so committing that render dropped the
	// track to 2 and left the bus map reading source channels 2-5, which no longer
	// existed: the engine refused to build a graph and the project could not play at all.
	const { project, freeze, digests, derivedSource, identities } = wideFixture();
	assert.equal(width(project), 6);
	assert.deepEqual(busMap(project), [0, 1, 2, 3, 4, 5]);

	assert.throws(() => applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install', trackId: 'stem', expectedFreeze: null,
		replacementFreeze: freeze, derivedSource: { ...derivedSource, channelCount: 2 },
		sourceContentIdentities: identities,
	} as never, { now: NOW }), /must keep audio track stem at 6 channels/u);

	const installed = applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install', trackId: 'stem', expectedFreeze: null,
		replacementFreeze: freeze, derivedSource, sourceContentIdentities: identities,
	} as never, { now: NOW });
	const committed = applySoundscaperProjectCommand(installed, {
		type: 'audio-freeze/commit', trackId: 'stem', expectedFreeze: freeze,
		operationDigests: digests, derivedSourceContentSha256: DERIVED_DIGEST,
		derivedClip: createAudioClip({
			id: 'stem-committed', sourceId: 'stem-freeze', title: 'Stem committed', anchor: 'sample',
			timelineStartFrame: 0, durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
		}),
	} as never);

	assert.equal(width(committed), 6);
	// The map is destination-indexed, so every entry names a source channel that the
	// frozen track must still have. This is exactly what the engine asserts before it
	// builds the splitter for this edge.
	assert.deepEqual(busMap(committed).filter((channel) => channel >= width(committed)), []);
});

function width(project: ReturnType<typeof createSoundscaperProject>): number {
	return resolveTerminalChannelWidths(project as never, project.masterChannels).tracks.get('stem') ?? 0;
}

function busMap(project: ReturnType<typeof createSoundscaperProject>): readonly number[] {
	return project.mixer.edges
		.find(({ id }) => id === 'assignment:track:stem:mixer-node:stems')?.channelMap ?? [];
}

function wideFixture() {
	const liveSource = createAudioSource({
		id: 'stem-live', storageKey: 'pcm:stem-live', frameCount: 512, contentSha256: LIVE_DIGEST,
		channelCount: 6, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const liveClip = createAudioClip({
		id: 'stem-clip', sourceId: 'stem-live', title: 'Stem', timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const base = createSoundscaperProject({
		id: 'freeze-width-project', title: 'Freeze width project', now: NOW, masterChannels: 2,
		sources: [liveSource], clips: [liveClip],
		tracks: [createAudioTrack({ id: 'stem', name: 'Stem', clipIds: ['stem-clip'] })],
		sequences: [{ id: 'main-sequence', trackIds: ['stem'] }], primarySequenceId: 'main-sequence',
	} as never);
	const project = applySoundscaperProjectCommand(base, {
		type: 'mixer-graph/set', expected: base.mixer,
		mixer: {
			...base.mixer,
			groups: [{
				id: 'stems', name: 'Stems', color: '', gain: 1, pan: 0, mute: false, solo: false,
				collapsed: false, effectsActive: true, effects: [], channelCount: 6,
			}],
			edges: [
				{
					id: 'assignment:track:stem:mixer-node:stems', kind: 'assignment',
					source: { kind: 'track', id: 'stem' }, destination: { kind: 'mixer-node', id: 'stems' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1, 2, 3, 4, 5],
				},
				{
					id: 'assignment:mixer-node:stems:master', kind: 'assignment',
					source: { kind: 'mixer-node', id: 'stems' }, destination: { kind: 'master' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
				},
				...base.mixer.edges.filter(({ source }) => source.kind === 'master'),
			],
		},
	} as never);
	const identities = Object.freeze([Object.freeze({ sourceId: 'stem-live', contentSha256: LIVE_DIGEST })]);
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: project.sampleRate, renderStartFrame: 0, renderFrameCount: 512,
		track: project.tracks[0], clips: project.clips,
		sourceContentIdentities: identities, automationLanes: project.automationLanes,
		tempoMap: project.tempoMap ?? null,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1, derivedSourceId: 'stem-freeze', ...digests,
		renderStartFrame: 0, renderFrameCount: 512, capturePosition: 'post-insert-pre-strip',
	};
	const derivedSource = createAudioSource({
		id: 'stem-freeze', storageKey: 'derived:stem-freeze', contentSha256: DERIVED_DIGEST,
		frameCount: 512, channelCount: 6, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	return { project, freeze, digests, derivedSource, identities };
}

function fixture() {
	const liveSource = createAudioSource({
		id: 'voice-live', storageKey: 'pcm:voice-live', frameCount: 512,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const liveClip = createAudioClip({
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
	const voiceTrack = createAudioTrack({
		id: 'voice', name: 'Voice', gain: 0.8, pan: -0.2, clipIds: ['voice-clip'],
		effects: [voiceEffect, automationEffect],
	});
	const project = createSoundscaperProject({
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
		tempoMap: project.tempoMap ?? null,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1, derivedSourceId: 'voice-freeze', ...digests,
		renderStartFrame: 0, renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
	const derivedSource = createAudioSource({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_DIGEST,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	return { project, freeze, digests, derivedSource, sourceContentIdentities };
}

function committedClip(): Readonly<Record<string, unknown>> {
	return createAudioClip({
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

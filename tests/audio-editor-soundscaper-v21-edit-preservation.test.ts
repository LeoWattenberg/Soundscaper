/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	preparePasteCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
} from '../src/common/editor/commands.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	applySoundscaperProjectCommand,
	soundscaperProjectForCommandConsumers,
} from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-08-14T13:00:00.000Z';

test('track ripple transforms only addressed track lanes through the exact interval map', () => {
	const project = fixture();
	const result = applySoundscaperProjectCommand(project, rippleCommand(project, ['voice']));

	assert.deepEqual(positions(result, 'voice-gain'), [0, 20, 60]);
	assert.deepEqual(lane(result, 'music-gain'), lane(project, 'music-gain'));
	assert.deepEqual(lane(result, 'master-gain'), lane(project, 'master-gain'));
});

test('visibly all-track ripple transforms master authority as one common interval map', () => {
	const project = fixture();
	const result = applySoundscaperProjectCommand(project, rippleCommand(project, ['voice', 'music']));

	assert.deepEqual(positions(result, 'voice-gain'), [0, 20, 60]);
	assert.deepEqual(positions(result, 'music-gain'), [0, 20, 60]);
	assert.deepEqual(positions(result, 'master-gain'), [0, 20, 60]);
});

test('range replacement discards its old automation interval and holds across new material', () => {
	const project = fixture();
	const command = prepareRangeReplacementCommand(
		soundscaperProjectForCommandConsumers(project),
		{
			trackId: 'voice', startFrame: 20, endFrame: 60,
			source: { name: 'processed.wav', storageKey: 'processed', frameCount: 20, channelCount: 2 },
		},
		stableIds('replacement-source', 'replacement-clip'),
	) as AudioEditorCommand;
	const result = applySoundscaperProjectCommand(project, command);

	assert.deepEqual(positions(result, 'voice-gain'), [0, 20, 40, 80]);
	assert.deepEqual(lane(result, 'voice-gain').segments.map(({ kind }) => kind), [
		'hold', 'hold', 'linear',
	]);
	assert.deepEqual(lane(result, 'music-gain'), lane(project, 'music-gain'));
});

test('insert paste opens only target-track automation and carries no strip lanes from clipboard', () => {
	const project = fixture();
	const command = preparePasteCommand({
		schemaVersion: 2, sampleRate: 48_000, durationFrames: 20,
		tracks: [{
			sourceTrackId: 'voice', sourceTrackName: 'Voice', sourceTrackType: 'audio',
			sourceLaneGroupId: null, clips: [],
		}],
	}, {
		atFrame: 50, mode: 'insert-track',
		project: soundscaperProjectForCommandConsumers(project),
	}, stableIds()) as AudioEditorCommand;
	const result = applySoundscaperProjectCommand(project, command);

	assert.deepEqual(positions(result, 'voice-gain'), [0, 50, 70, 120]);
	assert.deepEqual(lane(result, 'music-gain'), lane(project, 'music-gain'));
	assert.equal(result.automationLanes.length, project.automationLanes.length);
});

test('input edits preserve frozen authority verbatim so freshness classification can report stale', () => {
	const digest = 'ab'.repeat(32);
	const derived = createAudioSource({
		id: 'voice-freeze', name: 'Voice freeze', storageKey: 'derived:voice-freeze',
		contentSha256: digest, frameCount: 100, channelCount: 2,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const live = createAudioSource({
		id: 'voice-source', name: 'Voice source', storageKey: 'voice-source',
		contentSha256: 'cd'.repeat(32), frameCount: 100, channelCount: 2,
		sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: 'voice-source', title: 'Voice',
		timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 100, durationFrames: 100,
	});
	const frozenTrack = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'], audioFreeze: {
			schemaVersion: 1, derivedSourceId: 'voice-freeze',
			inputDigestSha256: digest, rackDigestSha256: digest,
			automationDigestSha256: digest, freshnessDigestSha256: digest,
			renderStartFrame: 0, renderFrameCount: 100,
			capturePosition: 'post-insert-pre-strip',
		},
	});
	const project = createSoundscaperProject({
		id: 'frozen-edit', title: 'Frozen edit', now: NOW,
		sources: [live, derived], clips: [clip], tracks: [frozenTrack],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [stripLane('voice-gain', { kind: 'track', id: 'voice' })],
	});
	const before = (project.tracks[0] as Readonly<Record<string, unknown>>).audioFreeze;
	const result = applySoundscaperProjectCommand(project, rippleCommand(project, ['voice']));

	assert.deepEqual((result.tracks[0] as Readonly<Record<string, unknown>>).audioFreeze, before);
	assert.deepEqual(positions(result as ReturnType<typeof fixture>, 'voice-gain'), [0, 20, 60]);
});

test('clip ripple removal uses the removed clip interval while ordinary clip geometry stays lane-neutral', () => {
	const source = createAudioSource({
		id: 'source', name: 'Source', storageKey: 'source', contentSha256: 'ef'.repeat(32),
		frameCount: 200, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const removedClip = createAudioClip({
		id: 'removed', sourceId: 'source', title: 'Removed', timelineStartFrame: 20,
		sourceStartFrame: 0, sourceDurationFrames: 40, durationFrames: 40,
	});
	const laterClip = createAudioClip({
		id: 'later', sourceId: 'source', title: 'Later', timelineStartFrame: 100,
		sourceStartFrame: 40, sourceDurationFrames: 40, durationFrames: 40,
	});
	const project = createSoundscaperProject({
		id: 'clip-ripple', title: 'Clip ripple', now: NOW,
		sources: [source], clips: [removedClip, laterClip],
		tracks: [createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: ['removed', 'later'],
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [stripLane('voice-gain', { kind: 'track', id: 'voice' })],
	});
	const result = applySoundscaperProjectCommand(project, {
		type: 'clip/remove-many', clipIds: ['removed'], rippleMode: 'track',
	});

	assert.deepEqual(positions(result as ReturnType<typeof fixture>, 'voice-gain'), [0, 20, 60]);
	assert.equal(result.clips.find(({ id }) => id === 'later')?.timelineStartFrame, 60);
});

test('effect removal atomically removes its lane while reorder preserves it byte-for-byte', () => {
	const project = effectFixture();
	const reordered = applySoundscaperProjectCommand(project, {
		type: 'effect/reorder', scope: 'track', trackId: 'voice', effectId: 'filter', toIndex: 0,
	});
	assert.deepEqual(lane(reordered, 'filter-frequency'), lane(project, 'filter-frequency'));

	const removed = applySoundscaperProjectCommand(reordered, {
		type: 'effect/remove', scope: 'track', trackId: 'voice', effectId: 'filter',
	});
	assert.equal(removed.automationLanes.some(({ id }) => id === 'filter-frequency'), false);
	const removedSidechain = applySoundscaperProjectCommand(removed, {
		type: 'effect/remove', scope: 'track', trackId: 'voice', effectId: 'limiter',
	});
	assert.equal(removedSidechain.mixer.edges.some(({ id }) => id === 'music-duck'), false);
});

test('mixer graph replacement drops lanes owned by removed edges in the same revision', () => {
	const project = edgeFixture();
	const candidate = {
		...project.mixer,
		edges: project.mixer.edges.filter(({ id }) => id !== 'voice-reverb'),
	};
	const result = applySoundscaperProjectCommand(project, {
		type: 'mixer-graph/set',
		expected: project.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: candidate as unknown as Readonly<Record<string, unknown>>,
	});

	assert.equal(result.automationLanes.some(({ id }) => id === 'reverb-level'), false);
	assert.equal(result.mixer.edges.some(({ id }) => id === 'voice-reverb'), false);
});

function fixture() {
	return createSoundscaperProject({
		id: 'automation-edit-preservation', title: 'Automation edit preservation', now: NOW,
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [
			stripLane('voice-gain', { kind: 'track', id: 'voice' }),
			stripLane('music-gain', { kind: 'track', id: 'music' }),
			stripLane('master-gain', { kind: 'master' }),
		],
	});
}

function effectFixture() {
	const limiter = createEffect('limiter', { id: 'limiter' });
	const filter = createEffect('highpass', { id: 'filter' });
	const tracks = [
		createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: [], effects: [limiter, filter],
		}),
		createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
	];
	const baseMixer = createDefaultMixerGraphV21([{ id: 'voice' }, { id: 'music' }]);
	return createSoundscaperProject({
		id: 'effect-preservation', title: 'Effect preservation', now: NOW,
		tracks,
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
		mixer: {
			...baseMixer,
			edges: [...baseMixer.edges, {
				id: 'music-duck', kind: 'sidechain',
				source: { kind: 'track', id: 'music' },
				destination: {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'limiter',
				},
				position: 'post-fader', level: 1, enabled: true, channelMap: [],
			}],
		},
		automationLanes: [{
			id: 'filter-frequency',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'voice' },
				effectId: 'filter', parameterId: 'frequency',
			},
			timebase: 'absolute-samples',
			points: [{ id: 'frequency', position: 0, value: 1_000 }], segments: [],
		}],
	});
}

function edgeFixture() {
	const base = fixture();
	const strip = {
		id: 'reverb', name: 'Reverb', color: '#4f87c8', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: true, effectsActive: true,
		effects: [], channelCount: 2,
	};
	const edge = {
		id: 'voice-reverb', kind: 'send' as const,
		source: { kind: 'track' as const, id: 'voice' },
		destination: { kind: 'mixer-node' as const, id: 'reverb' },
		position: 'post-fader' as const, level: 0.5, enabled: true, channelMap: [],
	};
	const returnEdge = {
		id: 'reverb-master', kind: 'assignment' as const,
		source: { kind: 'mixer-node' as const, id: 'reverb' },
		destination: { kind: 'master' as const },
		position: 'post-fader' as const, level: 1, enabled: true, channelMap: [],
	};
	return createSoundscaperProject({
		...base,
		mixer: {
			...base.mixer, sends: [strip], edges: [...base.mixer.edges, edge, returnEdge],
		},
		automationLanes: [...base.automationLanes, {
			id: 'reverb-level',
			address: { kind: 'edge', edgeId: 'voice-reverb', parameterId: 'level' },
			timebase: 'absolute-samples', points: [{ id: 'level', position: 0, value: 0.5 }], segments: [],
		}],
	});
}

function stripLane(id: string, strip: Readonly<Record<string, unknown>>) {
	return {
		id,
		address: { kind: 'strip', strip, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [
			{ id: `${id}-start`, position: 0, value: 0.5 },
			{ id: `${id}-jump`, position: 50, value: 0.75 },
			{ id: `${id}-end`, position: 100, value: 1 },
		],
		segments: [{ kind: 'hold' }, { kind: 'linear' }],
	};
}

function lane(project: ReturnType<typeof fixture>, id: string) {
	const value = project.automationLanes.find((candidate) => candidate.id === id);
	assert.ok(value);
	return value;
}

function positions(project: ReturnType<typeof fixture>, id: string): readonly unknown[] {
	return lane(project, id).points.map(({ position }) => position);
}

function rippleCommand(
	project: ReturnType<typeof createSoundscaperProject>,
	trackIds: readonly string[],
): AudioEditorCommand {
	return prepareRangeDeleteCommand(soundscaperProjectForCommandConsumers(project), {
		startFrame: 20, endFrame: 60, trackIds, rippleMode: 'track',
	}, () => 'unused') as AudioEditorCommand;
}

function stableIds(...values: string[]): (prefix?: string) => string {
	let index = 0;
	return (prefix = 'id') => values[index++] ?? `${prefix}-${String(index)}`;
}

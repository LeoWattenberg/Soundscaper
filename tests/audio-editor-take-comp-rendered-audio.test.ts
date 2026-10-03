/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createTakeCompControllerComposition } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-composition.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import {
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';

const NOW = '2026-09-27T12:00:00.000Z';
const SAMPLE_RATE = 48_000;

class ChannelMappingOfflineAudioContext extends MockGainRenderingOfflineAudioContext {
	createChannelSplitter(): ChannelSplitterNode {
		return this.make('channel-splitter') as unknown as ChannelSplitterNode;
	}

	createChannelMerger(): ChannelMergerNode {
		return this.make('channel-merger') as unknown as ChannelMergerNode;
	}
}

test('flatten renders the selected take samples and the published clip re-renders identically', async () => {
	let current = project();
	const persistedBuffers: MockAudioBuffer[] = [];
	let generation = 1;
	const ids = new Map<string, number>();
	const sourceA = constantBuffer(0.25);
	const sourceB = constantBuffer(-0.5);
	const sourceBuffers = new Map<string, AudioBuffer>([
		['source-a', sourceA as unknown as AudioBuffer],
		['source-b', sourceB as unknown as AudioBuffer],
	]);
	const composition = createTakeCompControllerComposition({
		lifetime: new EditorControllerLifetime(),
		sourceBuffers,
		sourceChunkProviders: new Map(),
		sourceResolver: null,
		derivedSources: {
			async persistRenderedMixSource(rendered: AudioBufferLike) {
				persistedBuffers.push(rendered as unknown as MockAudioBuffer);
				return {
					source: {
						id: 'flattened-source',
						storageKey: 'flattened-source',
						name: 'Rendered take comp',
						mimeType: 'audio/wav',
						frameCount: rendered.length,
						channelCount: rendered.numberOfChannels,
						sampleRate: rendered.sampleRate,
						originalSampleRate: rendered.sampleRate,
						sampleFormat: 'float32',
						chunkFrames: 65_536,
					},
					buffer: rendered,
					channels: Array.from({ length: rendered.numberOfChannels }, (_, channel) => (
						rendered.getChannelData(channel)
					)),
				};
			},
			rollbackDerivedSources: () => Promise.resolve(),
		} as never,
		getProject: () => current,
		editingBlocked: () => false,
		commit(command: AudioEditorCommand) {
			current = applyEditorCommand(current, command, { now: NOW }) as AudioEditorProjectV17;
			generation += 1;
			return current;
		},
		createId(prefix: string) {
			const next = (ids.get(prefix) ?? 0) + 1;
			ids.set(prefix, next);
			return `${prefix}-${String(next)}`;
		},
		captureProject: () => ({ generation, projectId: current.id }),
		assertProject: (token) => {
			if (token.projectId !== current.id || token.generation !== generation) {
				throw new Error('project changed');
			}
		},
		createPreviewEngine: () => { throw new Error('flatten must not create a preview engine'); },
		stopPlayback: () => undefined,
		renderSnapshot: (snapshot, range, buffers, signal) => render(
			snapshot,
			range as Readonly<{ readonly startFrame: number; readonly endFrame: number }>,
			buffers as Map<string, AudioBuffer>,
			signal,
		),
	});
	composition.promoteTake('group-a', {
		takeId: 'take-b',
		startSample: 200,
		endSample: 300,
	});

	const flattened = await composition.flatten('group-a');

	const persisted = persistedBuffers[0];
	assert.ok(persisted);
	assert.equal(persisted.length, 400);
	assertSelectedRegions(persisted.getChannelData(0));
	assert.equal(flattened.publication.clip.sourceId, 'flattened-source');
	assert.equal(current.takeGroups.length, 0);
	assert.equal(current.clips.length, 1);
	sourceBuffers.set('flattened-source', persisted as unknown as AudioBuffer);
	const reopened = await render(
		structuredClone(current) as EngineProject,
		{ startFrame: 100, endFrame: 500 },
		sourceBuffers,
		new AbortController().signal,
	);
	assert.equal(reopened.length, 400);
	assert.deepEqual(
		Array.from(reopened.getChannelData(0)),
		Array.from(persisted.getChannelData(0)),
	);
	await composition.dispose();
});

async function render(
	projectValue: EngineProject,
	range: Readonly<{ readonly startFrame: number; readonly endFrame: number }>,
	sourceBuffers: Map<string, AudioBuffer>,
	signal: AbortSignal,
): Promise<AudioBuffer> {
	const engine = createAudioEditorEngine({
		audioContextFactory: () => new MockAudioContext() as unknown as AudioContext,
		offlineAudioContextFactory: (options) => (
			new ChannelMappingOfflineAudioContext(options) as unknown as OfflineAudioContext
		),
		meterInterval: 1_000,
	});
	try {
		engine.loadProject(projectValue, sourceBuffers);
		return await engine.renderMix({ ...range, includeMaster: false, includeTrackPan: false, signal }) as AudioBuffer;
	} finally {
		await engine.dispose();
	}
}

function assertSelectedRegions(channel: Float32Array): void {
	// The minimal Web Audio double fans a mono splitter into both merger inputs;
	// normalize that fixed test-host gain while preserving the selected PCM signs
	// and magnitudes at every comp boundary.
	const hostGain = channel[0]! / 0.25;
	assert.ok(Number.isFinite(hostGain) && hostGain > 0);
	for (const [start, end, expected] of [
		[0, 100, 0.25],
		[100, 200, -0.5],
		[200, 400, 0.25],
	] as const) {
		for (let frame = start; frame < end; frame += 1) {
			assert.ok(
				Math.abs(channel[frame]! - expected * hostGain) < 1e-6,
				`frame ${String(frame)} selects ${String(expected)}, received ${String(channel[frame])}`,
			);
		}
	}
}

function constantBuffer(value: number): MockAudioBuffer {
	const buffer = new MockAudioBuffer(1, 1_000, SAMPLE_RATE);
	buffer.getChannelData(0).fill(value);
	return buffer;
}

function project(): AudioEditorProjectV17 {
	return createAudioEditorProjectV17({
		id: 'rendered-take-comp-project',
		title: 'Rendered take comp project',
		now: NOW,
		sources: [source('source-a'), source('source-b')],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [{
			id: 'group-a',
			sequenceId: 'main-sequence',
			trackId: 'track-a',
			startSample: 100,
			endSample: 500,
			laneOrder: ['lane-a', 'lane-b'],
			lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
			takes: [{
				id: 'take-a',
				laneId: 'lane-a',
				sourceId: 'source-a',
				startSample: 100,
				endSample: 500,
				sourceStartSample: 0,
			}, {
				id: 'take-b',
				laneId: 'lane-b',
				sourceId: 'source-b',
				startSample: 100,
				endSample: 500,
				sourceStartSample: 25,
			}],
			compRegions: [{
				id: 'original',
				takeId: 'take-a',
				startSample: 100,
				endSample: 500,
			}],
		}],
	});
}

function source(id: string) {
	return createAudioSource({
		id,
		storageKey: id,
		name: id,
		frameCount: 1_000,
		channelCount: 1,
		sampleRate: SAMPLE_RATE,
		provenance: createImportedSourceProvenance({
			id,
			origin: { kind: 'local-file', originalFileName: `${id}.wav`, mimeType: 'audio/wav' },
		}),
	});
}

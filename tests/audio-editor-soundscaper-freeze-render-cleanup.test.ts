/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { renderFreezeBody, type FreezeStore } from '../src/soundscaper/editor-audio-track-freeze-render.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('freeze render retires stored source readers when engine disposal throws synchronously', async () => {
	const source = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: '0'.repeat(64),
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 12,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const track = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id], effects: [] });
	const project = createSoundscaperProject({
		id: 'freeze-cleanup-project', title: 'Freeze cleanup', now: '2026-08-14T12:00:00.000Z',
		sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }], primarySequenceId: 'main-sequence',
	});
	const events: string[] = [];
	const engineFailure = new Error('engine reader retirement failed');
	const store = {
		getSourceMetadata: async () => ({
			id: 'pcm:voice', sourceToken: 'source-token', storage: 'test', frameCount: 8,
			channelCount: 1, sampleRate: 48_000, chunkFrames: 65_536,
		}),
		readSourceChunk: async () => ({ index: 0, frames: 8, channels: [new Float32Array(8)] }),
		openSourceReadSession: () => ({
			chunk: async () => ({ index: 0, frames: 8, channels: [new Float32Array(8)] }),
			release: async () => { events.push('source-reader-released'); },
		}),
	} as unknown as FreezeStore;
	let provider: Readonly<{ readStorageChunk(index: number): Promise<unknown> }> | undefined;
	const createEngine = () => ({
		loadProject(_project: unknown, _buffers: unknown, options?: Readonly<{ chunkSources?: ReadonlyMap<string, typeof provider> }>) {
			provider = options?.chunkSources?.get('voice-source');
		},
		async renderTrack() {
			assert.ok(provider);
			await provider.readStorageChunk(0);
			return { channels: [new Float32Array(8)] };
		},
		dispose() { events.push('engine-dispose'); throw engineFailure; },
	});

	await assert.rejects(
		renderFreezeBody(store, { project }, createEngine as never, {
			project, trackId: 'voice', renderStartFrame: 12, renderFrameCount: 8, sampleRate: 48_000,
		}),
		(error: unknown) => error instanceof AggregateError && error.errors[0] === engineFailure,
	);
	assert.deepEqual(events, ['engine-dispose', 'source-reader-released']);
});

test('freeze prepares a pitched clip and installs its source resolver before rendering', async () => {
	const source = createAudioSource({
		id: 'tone-source', storageKey: 'tone-source', contentSha256: '1'.repeat(64),
		frameCount: 8, channelCount: 1, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'tone-clip', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 8, durationFrames: 8,
		pitchCents: 1_200,
	});
	const project = createSoundscaperProject({
		id: 'pitched-freeze', title: 'Pitched freeze', now: '2026-08-14T12:00:00.000Z',
		sources: [source], clips: [clip], tracks: [createAudioTrack({
			id: 'tone', clipIds: [clip.id], effects: [],
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['tone'] }],
		primarySequenceId: 'main-sequence',
	});
	const events: string[] = [];
	const store = {
		getSourceMetadata: async () => ({ id: source.id, frameCount: 8, channelCount: 1,
			sampleRate: 48_000, chunkFrames: 65_536 }),
		readSourceChunk: async () => ({ index: 0, frames: 8, channels: [new Float32Array(8)] }),
	} as unknown as FreezeStore;
	let resolver: ((value: unknown) => unknown) | undefined;
	const engine = {
		setSourceResolver(value: (clipValue: unknown) => unknown) { events.push('resolver'); resolver = value; },
		loadProject() { events.push('load'); },
		async renderTrack() {
			events.push('render');
			assert.ok(resolver);
			assert.ok(resolver(clip));
			return { channels: [new Float32Array(8)] };
		},
		dispose() { events.push('dispose'); },
	};
	await renderFreezeBody(store, { project }, () => engine as never, {
		project, trackId: 'tone', renderStartFrame: 0, renderFrameCount: 8, sampleRate: 48_000,
	}, {
		prepareTimePitchCaches: async (renderProject) => {
			events.push('prepare');
			assert.equal((renderProject.clips as typeof project.clips)[0]?.pitchCents, 1_200);
		},
		sourceResolver: () => ({ buffer: {} as AudioBuffer }),
	});
	assert.deepEqual(events, ['prepare', 'resolver', 'load', 'render', 'dispose']);
	await assert.rejects(renderFreezeBody(store, { project }, () => engine as never, {
		project, trackId: 'tone', renderStartFrame: 0, renderFrameCount: 8, sampleRate: 48_000,
	}), /time\/pitch render.*unavailable/iu);
});

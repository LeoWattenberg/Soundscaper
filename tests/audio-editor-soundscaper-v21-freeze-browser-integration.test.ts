/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioTrackFreezeCoordinatorCommandV21 } from '../src/common/editor/audio-track-freeze-coordinator-v21.ts';
import type { EngineRenderMixOptions } from '../src/common/editor/engine/public-api.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import type { SourcePcmReadSession } from '../src/common/editor/storage/source-read-repository.ts';
import type { AudioSourceWriter } from '../src/common/editor/storage/source-write-repository.ts';
import {
	createSoundscaperAudioFreezeActionsV21,
	type SoundscaperAudioFreezeRenderEngineV21,
} from '../src/soundscaper/editor-audio-track-freeze-actions-v21.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV21,
} from '../src/soundscaper/editor-audio-track-freeze-playback-v21.ts';
import { createSoundscaperPlaybackProjectServiceV21 } from '../src/soundscaper/editor-project-playback-v21.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import { createSoundscaperProjectV21, type SoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T12:00:00.000Z';

test('browser freeze actions render, persist, activate, refresh, unfreeze, and commit exact V21 state', async () => {
	const store = new MemoryFreezeStore();
	store.seed('pcm:voice', [Float32Array.from({ length: 8 }, (_, index) => index / 8)]);
	const playback = createSoundscaperAudioTrackFreezePlaybackServiceV21(
		createSoundscaperPlaybackProjectServiceV21(),
		store,
	);
	const liveSourceSha256 = await playback.hashSourceContent('freeze-browser-project', createAudioSourceV10({
		id: 'voice-source', storageKey: 'pcm:voice', frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	}));
	let current = projectFixture(liveSourceSha256);
	const renderCalls: Array<Readonly<{ project: Record<string, unknown>; options: EngineRenderMixOptions }>> = [];
	const controller = {
		get project() { return current; },
		actions: {
			edit: {
				commit(command: AudioTrackFreezeCoordinatorCommandV21) {
					current = applySoundscaperProjectCommandV21(current, command, { now: NOW });
					return current;
				},
			},
		},
	};
	let sourceSequence = 0;
	let clipSequence = 0;
	const binding = createSoundscaperAudioFreezeActionsV21(
		{ store, playback },
		controller,
		{
			createId: (kind) => kind === 'source'
				? `voice-freeze-${String(++sourceSequence)}`
				: `voice-freeze-clip-${String(++clipSequence)}`,
			createRenderEngine: () => fakeRenderEngine(renderCalls),
		},
	);

	assert.equal(binding.actions.getStatus('voice'), 'none');
	const initialFreeze = binding.actions.freeze('voice');
	assert.equal(binding.actions.getStatus('voice'), 'verifying');
	await initialFreeze;
	assert.equal(binding.actions.getStatus('voice'), 'fresh');
	assert.equal(sourceSequence, 1);
	assert.equal(renderCalls.length, 1);
	const renderTrack = (renderCalls[0]!.project.tracks as Record<string, unknown>[])[0]!;
	assert.deepEqual(
		{ gain: renderTrack.gain, pan: renderTrack.pan, mute: renderTrack.mute, solo: renderTrack.solo },
		{ gain: 1, pan: 0, mute: false, solo: false },
	);
	// The capture is pre-master, so the render is sized by the track, not by the
	// programme. Sizing it from masterChannels re-widthed the track on commit and left
	// every channel map aimed at it reading channels the frozen source no longer had.
	assert.equal(current.masterChannels, 2);
	assert.equal(renderCalls[0]!.project.masterChannels, 1);
	assert.deepEqual(renderCalls[0]!.options, {
		startFrame: 12, endFrame: 20, includeTail: 0, includeMaster: false,
		includeTrackPan: false, respectMuteSolo: false, outputFrames: 8,
		preRollFrames: 0, signal: renderCalls[0]!.options.signal,
	});
	const firstFreeze = freezeTrack(current);
	assert.equal(firstFreeze.audioFreeze?.derivedSourceId, 'voice-freeze-1');
	assert.deepEqual(firstFreeze.clipIds, ['voice-clip']);
	const derived = current.sources.find(({ id }) => id === 'voice-freeze-1') as Record<string, unknown>;
	assert.match(String(derived.contentSha256), /^[a-f0-9]{64}$/u);
	assert.equal(Object.hasOwn(derived, 'pcm'), false);
	assert.equal(store.has('voice-freeze-1'), true);
	const playbackProjection = playback.projectForPlayback(current);
	assert.deepEqual(playbackProjection.requiredAudioSourceIds, ['voice-freeze-1']);
	assert.equal(projectedTrack(playbackProjection.project).effectsActive, false);
	assert.equal(projectedClip(playbackProjection.project).sourceId, 'voice-freeze-1');
	const reopenedPlayback = createSoundscaperAudioTrackFreezePlaybackServiceV21(
		createSoundscaperPlaybackProjectServiceV21(),
		store,
	);
	const reopened = structuredClone(current);
	await reopenedPlayback.prepareProjectForActivation?.(reopened);
	const reopenedProjection = reopenedPlayback.projectForPlayback(reopened);
	assert.equal(reopenedPlayback.getFreezeStatus(reopened, 'voice'), 'fresh');
	assert.deepEqual(reopenedProjection.requiredAudioSourceIds, ['voice-freeze-1']);
	assert.equal(projectedClip(reopenedProjection.project).sourceId, 'voice-freeze-1');
	const reopenedStale = applySoundscaperProjectCommandV21(reopened, {
		type: 'effect/add', scope: 'track', trackId: 'voice',
		effect: { id: 'stale-highpass', type: 'highpass', enabled: true, params: {} },
	});
	await reopenedPlayback.prepareProjectForActivation?.(reopenedStale);
	assert.equal(reopenedPlayback.getFreezeStatus(reopenedStale, 'voice'), 'stale');
	assert.equal(projectedClip(reopenedPlayback.projectForPlayback(reopenedStale).project).sourceId, 'voice-source');
	reopenedPlayback.dispose();
	current = applySoundscaperProjectCommandV21(current, {
		type: 'effect/add', scope: 'track', trackId: 'voice',
		effect: { id: 'live-stale-highpass', type: 'highpass', enabled: true, params: {} },
	});
	assert.equal(binding.actions.getStatus('voice'), 'stale');
	assert.equal(projectedClip(playback.projectForPlayback(current).project).sourceId, 'voice-source');

	await binding.actions.refresh('voice');
	assert.equal(binding.actions.getStatus('voice'), 'fresh');
	assert.equal(freezeTrack(current).audioFreeze?.derivedSourceId, 'voice-freeze-2');
	assert.equal(current.sources.some(({ id }) => id === 'voice-freeze-1'), false);
	assert.equal(store.has('voice-freeze-1'), true, 'refresh leaves history-owned bytes for retention');
	assert.deepEqual(playback.projectForPlayback(current).requiredAudioSourceIds, ['voice-freeze-2']);

	await binding.actions.unfreeze('voice');
	assert.equal(binding.actions.getStatus('voice'), 'none');
	assert.equal(Object.hasOwn(freezeTrack(current), 'audioFreeze'), false);
	assert.deepEqual(freezeTrack(current).clipIds, ['voice-clip']);
	assert.deepEqual(playback.projectForPlayback(current).requiredAudioSourceIds, []);
	assert.equal(store.has('voice-freeze-2'), true, 'unfreeze leaves history-owned bytes for retention');

	await binding.actions.freeze('voice');
	await binding.actions.commit('voice');
	const committedTrack = freezeTrack(current);
	assert.equal(Object.hasOwn(committedTrack, 'audioFreeze'), false);
	assert.deepEqual(committedTrack.effects, []);
	assert.deepEqual(committedTrack.clipIds, ['voice-freeze-clip-1']);
	const committed = current.clips.find(({ id }) => id === 'voice-freeze-clip-1') as Record<string, unknown>;
	assert.deepEqual({
		sourceId: committed.sourceId,
		timelineStartFrame: committed.timelineStartFrame,
		durationFrames: committed.durationFrames,
		gain: committed.gain,
	}, { sourceId: 'voice-freeze-3', timelineStartFrame: 12, durationFrames: 8, gain: 1 });
	assert.deepEqual(playback.projectForPlayback(current).requiredAudioSourceIds, []);
	assert.doesNotMatch(JSON.stringify(current), /"(?:pcm|channelData|audioBuffer|chunks|bytes|blob|data)"/u);

	await binding.dispose();
	playback.dispose();
});

test('an unrelated edit during a freeze does not discard the render', async () => {
	// A freeze asks after every awaited step whether the document still says what
	// it started against. Answering that by object identity discarded a freeze
	// whenever any command published a new document — clicking the timeline to
	// move the selection was enough to lose a long render.
	const store = new MemoryFreezeStore();
	store.seed('pcm:voice', [Float32Array.from({ length: 8 }, (_, index) => index / 8)]);
	const playback = createSoundscaperAudioTrackFreezePlaybackServiceV21(
		createSoundscaperPlaybackProjectServiceV21(),
		store,
	);
	const liveSourceSha256 = await playback.hashSourceContent('freeze-browser-project', createAudioSourceV10({
		id: 'voice-source', storageKey: 'pcm:voice', frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	}));
	let current = projectFixture(liveSourceSha256);
	const controller = {
		get project() { return current; },
		actions: {
			edit: {
				commit(command: AudioTrackFreezeCoordinatorCommandV21) {
					current = applySoundscaperProjectCommandV21(current, command, { now: NOW });
					return current;
				},
			},
		},
	};
	const renderCalls: Array<Readonly<{ project: Record<string, unknown>; options: EngineRenderMixOptions }>> = [];
	const binding = createSoundscaperAudioFreezeActionsV21(
		{ store, playback },
		controller,
		{
			createId: (kind) => kind === 'source' ? 'voice-freeze-1' : 'voice-freeze-clip-1',
			createRenderEngine: () => fakeRenderEngine(renderCalls, () => {
				current = applySoundscaperProjectCommandV21(current, {
					type: 'selection/set', startFrame: 0, endFrame: 4, trackIds: ['voice'],
				} as never, { now: NOW });
			}),
		},
	);

	await binding.actions.freeze('voice');
	assert.equal(binding.actions.getStatus('voice'), 'fresh');
	assert.equal(freezeTrack(current).audioFreeze?.derivedSourceId, 'voice-freeze-1');
	await binding.dispose();
	playback.dispose();
});

test('an edit to the frozen material during a freeze still discards the render', async () => {
	const store = new MemoryFreezeStore();
	store.seed('pcm:voice', [Float32Array.from({ length: 8 }, (_, index) => index / 8)]);
	const playback = createSoundscaperAudioTrackFreezePlaybackServiceV21(
		createSoundscaperPlaybackProjectServiceV21(),
		store,
	);
	const liveSourceSha256 = await playback.hashSourceContent('freeze-browser-project', createAudioSourceV10({
		id: 'voice-source', storageKey: 'pcm:voice', frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	}));
	let current = projectFixture(liveSourceSha256);
	const controller = {
		get project() { return current; },
		actions: {
			edit: {
				commit(command: AudioTrackFreezeCoordinatorCommandV21) {
					current = applySoundscaperProjectCommandV21(current, command, { now: NOW });
					return current;
				},
			},
		},
	};
	const renderCalls: Array<Readonly<{ project: Record<string, unknown>; options: EngineRenderMixOptions }>> = [];
	const binding = createSoundscaperAudioFreezeActionsV21(
		{ store, playback },
		controller,
		{
			createId: (kind) => kind === 'source' ? 'voice-freeze-1' : 'voice-freeze-clip-1',
			createRenderEngine: () => fakeRenderEngine(renderCalls, () => {
				current = applySoundscaperProjectCommandV21(current, {
					type: 'effect/add', scope: 'track', trackId: 'voice',
					effect: { id: 'mid-render-highpass', type: 'highpass', enabled: true, params: {} },
				} as never, { now: NOW });
			}),
		},
	);

	await assert.rejects(() => binding.actions.freeze('voice'), /freeze project changed/iu);
	assert.equal(Object.hasOwn(freezeTrack(current), 'audioFreeze'), false);
	await binding.dispose();
	playback.dispose();
});

function projectFixture(contentSha256: string): SoundscaperProjectV21 {
	const source = createAudioSourceV10({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 12,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', gain: 0.25, pan: 0.5, mute: true,
		clipIds: [clip.id], effects: [],
	});
	return createSoundscaperProjectV21({
		id: 'freeze-browser-project', title: 'Freeze browser integration', now: NOW,
		sources: [source], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}

function fakeRenderEngine(
	calls: Array<Readonly<{ project: Record<string, unknown>; options: EngineRenderMixOptions }>>,
	onRender?: () => void,
): SoundscaperAudioFreezeRenderEngineV21 {
	let project: Record<string, unknown> | null = null;
	return {
		loadProject(value: unknown) {
			project = value as Record<string, unknown>;
		},
		async renderTrack(_trackId: unknown, options: EngineRenderMixOptions = {}) {
			assert.ok(project);
			calls.push({ project, options });
			onRender?.();
			const frames = Number(options.outputFrames);
			return { channels: [Float32Array.from({ length: frames }, (_, index) => (index + 1) / frames)] };
		},
		async dispose() { /* no-op */ },
	};
}

function freezeTrack(project: SoundscaperProjectV21): Record<string, unknown> & {
	readonly audioFreeze?: Readonly<{ readonly derivedSourceId: string }>;
} {
	return project.tracks.find(({ id }) => id === 'voice') as never;
}

function projectedTrack(project: object): Record<string, unknown> {
	return (project as { tracks: Record<string, unknown>[] }).tracks.find(({ id }) => id === 'voice')!;
}

function projectedClip(project: object): Record<string, unknown> {
	const target = projectedTrack(project);
	return (project as { clips: Record<string, unknown>[] }).clips
		.find(({ id }) => id === (target.clipIds as string[])[0])!;
}

interface StoredPcm {
	readonly metadata: StorageRecord;
	readonly chunks: readonly Readonly<{
		readonly index: number;
		readonly frames: number;
		readonly channels: readonly Float32Array[];
	}>[];
}

class MemoryFreezeStore {
	readonly #sources = new Map<string, StoredPcm>();
	#token = 0;

	seed(id: string, channels: readonly Float32Array[]): void {
		this.#sources.set(id, this.#stored(id, channels, `seed-${String(++this.#token)}`, {}));
	}

	has(id: string): boolean { return this.#sources.has(id); }

	getSourceMetadata(id: string): StorageRecord | null {
		return this.#sources.get(id)?.metadata ?? null;
	}

	async *readSourceChunks(id: string): AsyncIterable<StoredPcm['chunks'][number]> {
		const source = this.#sources.get(id);
		if (!source) throw new Error(`Missing source ${id}`);
		for (const chunk of source.chunks) yield chunk;
	}

	async readSourceChunk(id: string, index: number): Promise<StoredPcm['chunks'][number]> {
		const chunk = this.#sources.get(id)?.chunks[index];
		if (!chunk) throw new Error(`Missing source chunk ${id}:${String(index)}`);
		return chunk;
	}

	openSourceReadSession(id: string): SourcePcmReadSession | null {
		if (!this.#sources.has(id)) return null;
		return {
			chunk: (index: number) => this.readSourceChunk(id, index),
			release: () => Promise.resolve(),
		};
	}

	async beginSourceWrite(id: string, metadata: Record<string, unknown>): Promise<AudioSourceWriter> {
		const chunks: Float32Array[][] = [];
		let framesWritten = 0;
		let closed = false;
		return {
			get framesWritten() { return framesWritten; },
			async write(inputChannels: unknown, { signal }: { signal?: AbortSignal } = {}) {
				if (closed) throw new Error('writer closed');
				if (signal?.aborted) throw signal.reason;
				if (!Array.isArray(inputChannels)
					|| inputChannels.some((channel) => !(channel instanceof Float32Array))) {
					throw new TypeError('test PCM channels are required');
				}
				const channels = inputChannels as readonly Float32Array[];
				const snapshot = channels.map((channel) => channel.slice());
				chunks.push(snapshot);
				framesWritten += snapshot[0]?.length ?? 0;
			},
			commit: async (
				extra: Record<string, unknown> = {},
				options: { signal?: AbortSignal; ifAbsent?: boolean } = {},
			) => {
				if (closed) throw new Error('writer closed');
				if (options.signal?.aborted) throw options.signal.reason;
				closed = true;
				if (options.ifAbsent && this.#sources.has(id)) throw new Error('source collision');
				const channels = chunks[0]!.map((_channel, channelIndex) => {
					const joined = new Float32Array(framesWritten);
					let offset = 0;
					for (const chunk of chunks) {
						joined.set(chunk[channelIndex]!, offset);
						offset += chunk[channelIndex]!.length;
					}
					return joined;
				});
				const stored = this.#stored(id, channels, `write-${String(++this.#token)}`, { ...metadata, ...extra });
				this.#sources.set(id, stored);
				return stored.metadata;
			},
			abort: async () => { closed = true; },
		};
	}

	async discardSourceIfCurrent(authority: StorageRecord): Promise<boolean> {
		const current = this.#sources.get(String(authority.id));
		if (!current || current.metadata.sourceToken !== authority.sourceToken) return false;
		this.#sources.delete(String(authority.id));
		return true;
	}

	#stored(
		id: string,
		channels: readonly Float32Array[],
		sourceToken: string,
		extra: Record<string, unknown>,
	): StoredPcm {
		const frameCount = channels[0]?.length ?? 0;
		const chunkFrames = 65_536;
		const chunks = Object.freeze(Array.from(
			{ length: Math.ceil(frameCount / chunkFrames) },
			(_, index) => {
				const start = index * chunkFrames;
				const end = Math.min(frameCount, start + chunkFrames);
				return Object.freeze({
					index, frames: end - start,
					channels: Object.freeze(channels.map((channel) => channel.slice(start, end))),
				});
			},
		));
		return Object.freeze({
			metadata: Object.freeze({
				...extra, id, storage: 'memory-test', sourceToken,
				frameCount, channelCount: channels.length,
				sampleRate: Number(extra.sampleRate ?? 48_000), chunkFrames,
			}),
			chunks,
		});
	}
}

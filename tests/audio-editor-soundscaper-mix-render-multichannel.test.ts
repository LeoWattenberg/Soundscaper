/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDerivedSourceService } from '../src/common/editor/controller/derived-source-service.ts';
import { createMixRenderService } from '../src/common/editor/controller/mix-render-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import type { ControllerSource } from '../src/common/editor/controller/track-domain-types.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 4;
const CHANNEL_COUNT = 6;

for (const streamToStorage of [false, true]) {
	test(`Soundscaper Mix and Render preserves six channels through the ${streamToStorage ? 'streamed' : 'buffered'} path`, async () => {
		const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) => (
			Float32Array.from({ length: FRAME_COUNT }, (_, frame) => channel + frame / 10)
		));
		const rendered = audioBuffer(channels);
		const project = surroundProject();
		let preflightBytes = -1;
		let persistedBuffer: AudioBufferLike | null = null;
		let beginMetadata: Readonly<Record<string, unknown>> | null = null;
		let commitMetadata: Readonly<Record<string, unknown>> | null = null;
		let activatedSource: ControllerSource | null = null;
		let writerChannelCount = 0;
		let writerFrames = 0;
		let id = 0;
		const streamingWriter = {
			get channelCount() { return writerChannelCount; },
			get framesWritten() { return writerFrames; },
			write(packet: Float32Array[]) {
				writerChannelCount ||= packet.length;
				assert.equal(packet.length, writerChannelCount);
				writerFrames += packet[0]?.length ?? 0;
			},
			commit(metadata?: Readonly<Record<string, unknown>>) {
				commitMetadata = metadata ?? null;
				return Promise.resolve({});
			},
			abort() {},
		};
		const service = createMixRenderService({
			lifetime: {
				assertActive() {},
				startTask: () => ({ assertCurrent() {}, finish() {} }),
			},
			copy: {
				v2Required: 'V2 required',
				mixRenderRequiresAudio: 'Audio required',
				audacitySelectionHint: 'Select audio',
				audioTrackRequired: 'Audio track required',
				rendering: 'Rendering',
				mixedTrack: 'Mix',
				mixRender: 'Mix and Render',
				mixdownTo: 'Mix down',
				effectInvalidAudio: 'Invalid audio',
				done: 'Done',
			},
			derivedSources: {
				persistRenderedMixSource: (buffer: AudioBufferLike, name: string) => {
					persistedBuffer = buffer;
					return Promise.resolve({
						source: derivedSource(buffer.numberOfChannels, name),
						buffer,
						channels: Array.from(
							{ length: buffer.numberOfChannels },
							(_, channel) => buffer.getChannelData(channel),
						),
					});
				},
				rollbackDerivedSources: () => Promise.resolve(),
			} as never,
			store: {
				beginSourceWrite: (_sourceId: string, metadata: Readonly<Record<string, unknown>>) => {
					beginMetadata = metadata;
					return Promise.resolve({ write() {}, commit: () => Promise.resolve({}), abort() {} });
				},
			},
			sourceBuffers: new Map(),
			sourceChunkFrames: 65_536,
			memoryLimitBytes: streamToStorage ? 0 : Number.MAX_SAFE_INTEGER,
			getProject: () => project as never,
			getSelectedTrackId: () => 'surround-track',
			getSelectedClipId: () => null,
			editingBlocked: () => false,
			captureProject: () => ({ id: project.id, generation: 1 }) as never,
			assertProject() {},
			createId: (prefix: string) => `${prefix}-${++id}`,
			commit: () => undefined,
			preflightStorage: (bytes: number) => {
				preflightBytes = bytes;
				return Promise.resolve();
			},
			setProcessing() {},
			setStatus() {},
			publish() {},
			handleError() {},
			rackTailFrames: () => 0,
			isFixedStereoEffect: () => false,
			renderSnapshot: () => Promise.resolve(rendered),
			getAudioContext: () => Promise.resolve({}),
			createBufferFromChannels: (outputChannels: Float32Array[]) => (
				Promise.resolve(audioBuffer(outputChannels))
			),
			createRenderEngine: () => ({
				loadProject() {},
				async renderMixToSink(options: Readonly<Record<string, unknown>>) {
					const sink = options.sink as Readonly<{
						write(packet: Float32Array[]): Promise<unknown> | unknown;
					}>;
					await sink.write(channels);
					return {
						sampleRate: SAMPLE_RATE,
						channelCount: CHANNEL_COUNT,
						frameCount: FRAME_COUNT,
					};
				},
				dispose() {},
			}),
			createStreamingWriter: () => streamingWriter,
			prepareCommittedTimePitchCaches: () => Promise.resolve(),
			activateStoredSource: (source: ControllerSource) => {
				activatedSource = source;
				return Promise.resolve();
			},
		} as never);

		await service.mixAndRenderTracks();

		assert.equal(preflightBytes, FRAME_COUNT * CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT);
		if (streamToStorage) {
			assert.equal(beginMetadata?.channelCount, CHANNEL_COUNT);
			assert.equal(commitMetadata?.channelCount, CHANNEL_COUNT);
			assert.equal(activatedSource?.channelCount, CHANNEL_COUNT);
			assert.equal(writerChannelCount, CHANNEL_COUNT);
			assert.equal(writerFrames, FRAME_COUNT);
		} else {
			assert.equal(persistedBuffer?.numberOfChannels, CHANNEL_COUNT);
		}
	});
}

test('buffered derived mix persistence admits Soundscaper surround geometry', async () => {
	const channels = Array.from({ length: CHANNEL_COUNT }, (_, channel) => (
		Float32Array.from({ length: FRAME_COUNT }, (_, frame) => channel + frame / 10)
	));
	let beginMetadata: Readonly<Record<string, unknown>> | null = null;
	let commitMetadata: Readonly<Record<string, unknown>> | null = null;
	let writtenChannels = 0;
	const buffers = new Map<string, AudioBufferLike>();
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		getProject: () => surroundProject() as never,
		captureProject: () => ({ generation: 1, projectId: 'surround-mix' }),
		assertProject() {},
		createId: () => 'mixed-source',
		projectSampleRate: () => SAMPLE_RATE,
		retireSourceChunkProvider: () => Promise.resolve(),
		getAudioContext: () => Promise.resolve({}),
		createBufferFromChannels: (values: Float32Array[]) => Promise.resolve(audioBuffer(values)),
		loadSourceChannels: () => Promise.resolve(channels),
		writeBuffer: async (writer, buffer) => {
			const values = Array.from(
				{ length: buffer.numberOfChannels },
				(_, channel) => buffer.getChannelData(channel),
			);
			await writer.write(values);
		},
		generateWaveformPeaks: () => Promise.resolve({ levels: [] }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		cacheSourceBuffer: (sourceId: string, buffer: AudioBufferLike) => { buffers.set(sourceId, buffer); },
		sourceBuffers: buffers,
		sourcePeaks: new Map(),
		sourceChunkFrames: 65_536,
		store: {
			beginSourceWrite: (_sourceId: string, metadata: Readonly<Record<string, unknown>>) => {
				beginMetadata = metadata;
				return Promise.resolve({
					write: (packet: Float32Array[]) => { writtenChannels = packet.length; },
					commit: (metadata?: Readonly<Record<string, unknown>>) => {
						commitMetadata = metadata ?? null;
						return Promise.resolve();
					},
					abort() {},
				});
			},
			saveAnalysis: () => Promise.resolve(),
			deleteSource: () => Promise.resolve(),
		},
	} as never);

	const result = await service.persistRenderedMixSource(audioBuffer(channels), 'Surround mix');

	assert.equal(result.source.channelCount, CHANNEL_COUNT);
	assert.equal(beginMetadata?.channelCount, CHANNEL_COUNT);
	assert.equal(commitMetadata?.channelCount, CHANNEL_COUNT);
	assert.equal(writtenChannels, CHANNEL_COUNT);
});

function surroundProject() {
	const source = createAudioSource({
		id: 'surround-source', storageKey: 'surround-source', name: 'Surround', mimeType: 'audio/wav',
		frameCount: FRAME_COUNT, channelCount: CHANNEL_COUNT, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'surround-clip', sourceId: source.id, title: 'Surround', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: FRAME_COUNT, durationFrames: FRAME_COUNT,
	});
	return createSoundscaperProject({
		id: 'surround-mix', title: 'Surround mix', now: '2026-08-31T00:00:00.000Z',
		masterChannels: CHANNEL_COUNT,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'surround-track', name: 'Surround', clipIds: [clip.id] })],
		sequences: [{ id: 'main-sequence', trackIds: ['surround-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function audioBuffer(channels: Float32Array[]): AudioBufferLike {
	return {
		numberOfChannels: channels.length,
		length: channels[0]?.length ?? 0,
		sampleRate: SAMPLE_RATE,
		getChannelData: (channel: number) => channels[channel]!,
	};
}

function derivedSource(channelCount: number, name: string): ControllerSource {
	return {
		id: 'mixed-source', storageKey: 'mixed-source', name, mimeType: 'audio/wav',
		frameCount: FRAME_COUNT, channelCount, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	};
}

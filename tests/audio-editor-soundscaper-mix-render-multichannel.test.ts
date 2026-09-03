/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDerivedSourceService } from '../src/common/editor/controller/derived-source-service.ts';
import { createMixRenderService } from '../src/common/editor/controller/mix-render-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source-audio.ts';
import { createEffect } from '../src/common/editor/effects.js';
import type {
	ControllerProject,
	ControllerSource,
	SourceWriter,
} from '../src/common/editor/controller/track-domain-types.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 4;
const CHANNEL_COUNT = 6;
const MIX_RENDER_LAYOUT_CASES = [1, 2, CHANNEL_COUNT].flatMap((outputChannelCount) => [
	{ outputChannelCount, streamToStorage: false },
	{ outputChannelCount, streamToStorage: true },
]);

for (const { outputChannelCount, streamToStorage } of MIX_RENDER_LAYOUT_CASES) {
	test(`Soundscaper Mix and Render writes a chosen ${String(outputChannelCount)}-channel ${streamToStorage ? 'streamed' : 'buffered'} mix`, async () => {
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
		let writerOutput: Float32Array[] | null = null;
		let renderedMasterChannels = 0;
		let id = 0;
		const streamingWriter = {
			get channelCount() { return writerChannelCount; },
			get framesWritten() { return writerFrames; },
			write(packet: Float32Array[]) {
				writerChannelCount ||= packet.length;
				assert.equal(packet.length, writerChannelCount);
				writerFrames += packet[0]?.length ?? 0;
				writerOutput = packet.map((channel) => channel.slice());
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
			renderSnapshot: (candidate: ControllerProject) => {
				renderedMasterChannels = Number(candidate.masterChannels);
				return Promise.resolve(rendered);
			},
			getAudioContext: () => Promise.resolve({}),
			createBufferFromChannels: (outputChannels: Float32Array[]) => (
				Promise.resolve(audioBuffer(outputChannels))
			),
			createRenderEngine: () => ({
				loadProject(candidate: ControllerProject) {
					renderedMasterChannels = Number(candidate.masterChannels);
				},
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
			previewCommand: (candidate: never, command: never) => applySoundscaperProjectCommand(
				candidate, command, { now: '2026-09-03T00:00:00.000Z' },
			) as never,
		} as never);

		await service.mixAndRenderTracks({
			mixDown: true,
			mixDownChannelCount: outputChannelCount,
			renderEffects: true,
			replaceOriginals: true,
		});

		assert.equal(preflightBytes, FRAME_COUNT * outputChannelCount * Float32Array.BYTES_PER_ELEMENT);
		assert.equal(renderedMasterChannels, CHANNEL_COUNT, 'the authored render topology stays six-channel');
		if (streamToStorage) {
			assert.equal((beginMetadata as Readonly<Record<string, unknown>> | null)?.channelCount, outputChannelCount);
			assert.equal((commitMetadata as Readonly<Record<string, unknown>> | null)?.channelCount, outputChannelCount);
			assert.equal((activatedSource as ControllerSource | null)?.channelCount, outputChannelCount);
			assert.equal(writerChannelCount, outputChannelCount);
			assert.equal(writerFrames, FRAME_COUNT);
			assertMixOutput(writerOutput, channels, outputChannelCount);
		} else {
			assert.equal((persistedBuffer as AudioBufferLike | null)?.numberOfChannels, outputChannelCount);
			const output = persistedBuffer as AudioBufferLike | null;
			assertMixOutput(output && Array.from(
				{ length: output.numberOfChannels }, (_, channel) => output.getChannelData(channel),
			), channels, outputChannelCount);
		}
	});
}

test('Soundscaper Mix and Render refuses a stereo-only effect on a surround strip before rendering', async () => {
	const project = surroundProject({
		trackEffects: [createEffect('reverb', { id: 'surround-reverb' })],
	});
	let rendered = false;
	let preflighted = false;
	const service = createMixRenderService({
		lifetime: {
			assertActive() {},
			startTask: () => ({ assertCurrent() {}, finish() {} }),
		},
		copy: {
			v2Required: 'V2 required', rendering: 'Rendering', mixedTrack: 'Mix',
			mixRender: 'Mix and Render', mixdownTo: 'Mix down',
		},
		memoryLimitBytes: Number.MAX_SAFE_INTEGER,
		getProject: () => project as never,
		getSelectedTrackId: () => 'surround-track',
		getSelectedClipId: () => null,
		editingBlocked: () => false,
		captureProject: () => ({ id: project.id, generation: 1 }) as never,
		assertProject() {},
		setProcessing() {},
		setStatus() {},
		publish() {},
		handleError() {},
		rackTailFrames: () => 0,
		preflightStorage: () => { preflighted = true; return Promise.resolve(); },
		renderSnapshot: () => { rendered = true; return Promise.reject(new Error('unexpected render')); },
	} as never);

	await assert.rejects(
		() => service.mixAndRenderTracks(),
		/multichannel.*reverb|reverb.*channel width/iu,
	);
	assert.equal(preflighted, false);
	assert.equal(rendered, false);
});

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
		writeBuffer: async (writer: SourceWriter, buffer: AudioBufferLike) => {
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
	assert.equal((beginMetadata as Readonly<Record<string, unknown>> | null)?.channelCount, CHANNEL_COUNT);
	assert.equal((commitMetadata as Readonly<Record<string, unknown>> | null)?.channelCount, CHANNEL_COUNT);
	assert.equal(writtenChannels, CHANNEL_COUNT);
});

function surroundProject({
	trackEffects = [],
}: Readonly<{
	trackEffects?: readonly ReturnType<typeof createEffect>[];
}> = {}) {
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
		tracks: [createAudioTrack({
			id: 'surround-track', name: 'Surround', clipIds: [clip.id], effects: trackEffects,
		})],
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

function assertMixOutput(
	actual: readonly Float32Array[] | null,
	input: readonly Float32Array[],
	outputChannelCount: number,
): void {
	assert.ok(actual);
	assert.equal(actual.length, outputChannelCount);
	if (outputChannelCount === CHANNEL_COUNT) {
		for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
			assert.deepEqual(actual[channel], input[channel]);
		}
		return;
	}
	for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
		const left = input[0]![frame]!
			+ input[2]![frame]! * Math.SQRT1_2
			+ input[3]![frame]! * 0.5
			+ input[4]![frame]! * Math.SQRT1_2;
		const right = input[1]![frame]!
			+ input[2]![frame]! * Math.SQRT1_2
			+ input[3]![frame]! * 0.5
			+ input[5]![frame]! * Math.SQRT1_2;
		const expected = outputChannelCount === 1
			? [(left + right) * Math.SQRT1_2]
			: [left, right];
		for (let channel = 0; channel < outputChannelCount; channel += 1) {
			assert.ok(
				Math.abs(actual[channel]![frame]! - expected[channel]!) < 1e-5,
				`channel ${String(channel)} frame ${String(frame)} must use the selected fold-down`,
			);
		}
	}
}

function derivedSource(channelCount: number, name: string): ControllerSource {
	return {
		id: 'mixed-source', storageKey: 'mixed-source', name, mimeType: 'audio/wav',
		frameCount: FRAME_COUNT, channelCount, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	};
}

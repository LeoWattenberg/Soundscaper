/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeAiff } from '../src/common/editor/aiff.js';
import { streamAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

test('desktop small WAV and maintained AIFF PCM imports stay on bounded first-party readers', async () => {
	for (const input of [
		trackedAudioFile(pcmWav(), 'short.wav', 'audio/wav'),
		trackedAudioFile(aiff('int16'), 'classic.aiff', ''),
		trackedAudioFile(aiff('float32'), 'float.aiff', 'audio/aiff'),
	]) {
		const fixture = importFixture();
		const result = await fixture.service.importFile(input);

		assert.equal(result.destination, 'timeline', input.name);
		assert.equal(fixture.brokerCalls, 0, input.name);
		assert.equal(fixture.contextCalls, 0, input.name);
		assert.equal(fixture.webAudioDecodeCalls, 0, input.name);
		assert.equal(input.wholeBodyReads, 0, input.name);
		assert.deepEqual(fixture.writtenFrameCounts, [2, 2, 1], input.name);
		assert.deepEqual(fixture.activationOptions, [{ requireChunkStream: true }], input.name);
		assert.deepEqual(fixture.addedMimeTypes, [input.name.endsWith('.wav') ? 'audio/wav' : 'audio/aiff']);
		assert.ok(Math.max(...input.ranges.map(([start, end]) => end - start)) <= 44, input.name);
	}
});

test('desktop AIFF cancellation aborts staging after one bounded PCM chunk', async () => {
	const cancellation = new DOMException('cancel standalone AIFF import', 'AbortError');
	const input = trackedAudioFile(aiff('int16'), 'cancelled.aiff', 'audio/aiff');
	const fixture = importFixture({ writerFailure: cancellation });

	await assert.rejects(() => fixture.service.importFile(input), (error) => error === cancellation);
	assert.equal(fixture.brokerCalls, 0);
	assert.equal(fixture.contextCalls, 0);
	assert.equal(fixture.webAudioDecodeCalls, 0);
	assert.equal(input.wholeBodyReads, 0);
	assert.deepEqual(fixture.writtenFrameCounts, [2]);
	assert.deepEqual(input.ranges.at(-1), [54, 62]);
	assert.equal(fixture.writerAborts, 1);
	assert.equal(fixture.writerCommits, 0);
	assert.equal(fixture.activations, 0);
});

test('maintained AIFF streaming observes cancellation before reading another chunk', async () => {
	const cancellation = new DOMException('stop bounded AIFF streaming', 'AbortError');
	const controller = new AbortController();
	const input = trackedAudioFile(aiff('int16'), 'stream.aiff', 'audio/aiff');
	let chunks = 0;

	await assert.rejects(streamAiffBlobPcm(input, {
		chunkFrames: 2,
		signal: controller.signal,
		onChunk() {
			chunks += 1;
			controller.abort(cancellation);
		},
	}), (error) => error === cancellation);
	assert.equal(chunks, 1);
	assert.equal(input.wholeBodyReads, 0);
	assert.deepEqual(input.ranges.at(-1), [54, 62]);
});

test('browser small WAV import retains Web Audio before codec fallback', async () => {
	const stop = new Error('stop after browser decode');
	const input = trackedAudioFile(pcmWav(), 'browser.wav', 'audio/wav');
	const fixture = importFixture({ browser: true, canonicalFailure: stop });

	await assert.rejects(() => fixture.service.importFile(input), (error) => error === stop);
	assert.equal(fixture.contextCalls, 1);
	assert.equal(fixture.webAudioDecodeCalls, 1);
	assert.equal(fixture.brokerCalls, 0);
	assert.equal(input.wholeBodyReads, 1);
	assert.deepEqual(fixture.writtenFrameCounts, []);
});

function importFixture(options: Readonly<{
	browser?: boolean;
	canonicalFailure?: Error;
	writerFailure?: Error;
}> = {}) {
	let nextId = 0;
	let brokerCalls = 0;
	let contextCalls = 0;
	let webAudioDecodeCalls = 0;
	let writerAborts = 0;
	let writerCommits = 0;
	let activations = 0;
	const activationOptions: Array<Readonly<{ requireChunkStream?: boolean }>> = [];
	const addedMimeTypes: string[] = [];
	const writtenFrameCounts: number[] = [];
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const project = { id: 'pcm-import', revision: 0, metadata: {}, tracks: [], sources: [], clips: [] };
	const codec = {
		...(options.browser ? {} : { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const }),
		async decode() { brokerCalls += 1; throw new Error('The compressed-codec broker must not receive maintained PCM.'); },
	};
	const decoded = Object.freeze({ length: 5, numberOfChannels: 2, sampleRate: 48_000 });
	const runtime = runtimeProxy<ProjectImportRuntime>({
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32 * 1024 * 1024,
		SOURCE_CHUNK_FRAMES: 2,
		activateStoredSource: async (
			_source: unknown,
			_metadata: unknown,
			activation: Readonly<{ requireChunkStream?: boolean }>,
		) => { activations += 1; activationOptions.push(activation); },
		bufferFromChannels: async () => decoded,
		canonicalizeBuffer: async () => {
			if (options.canonicalFailure) throw options.canonicalFailure;
			return decoded;
		},
		commit: () => undefined,
		copy: {
			audioTrackNotFound: 'Audio track not found.',
			timelineFramesFinite: 'Frames must be finite.',
			track: 'Track',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: { mimeType: string }) => {
			addedMimeTypes.push(source.mimeType);
			return { type: 'source/add', source };
		},
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		editingBlocked: () => false,
		engine: {
			getAudioContext: async () => { contextCalls += 1; return {}; },
			decodeAudioData: async () => { webAudioDecodeCalls += 1; return decoded; },
		},
		ffmpeg: codec,
		findTrack: () => null,
		getProject: () => project,
		inspectEncodedAudioSampleRate: () => 48_000,
		inspectWavBlobPcm,
		isAudioEditorEngineSupported: () => true,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isLegacyBlockFile: () => false,
		isWavFile: (file: { name: string }) => /\.wav$/iu.test(file.name),
		preflightStorage: async () => undefined,
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async () => undefined,
		sourceBuffers,
		sourcePcmBytes: (descriptor: { frameCount?: number; channelCount?: number }) => (
			Number(descriptor?.frameCount) * Number(descriptor?.channelCount) * Float32Array.BYTES_PER_ELEMENT
		),
		sourcePeaks,
		store: {
			async beginSourceWrite() {
				return {
					async abort() { writerAborts += 1; },
					async commit() { writerCommits += 1; return { chunkCount: writtenFrameCounts.length }; },
					async write(channels: readonly Float32Array[]) {
						writtenFrameCounts.push(channels[0]?.length ?? 0);
						if (options.writerFailure) throw options.writerFailure;
					},
				};
			},
			deleteSource: async () => undefined,
		},
		streamWavBlobPcm,
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => undefined,
	});
	return {
		addedMimeTypes,
		activationOptions,
		get activations() { return activations; },
		get brokerCalls() { return brokerCalls; },
		get contextCalls() { return contextCalls; },
		service: createProjectImportService(runtime),
		get webAudioDecodeCalls() { return webAudioDecodeCalls; },
		get writerAborts() { return writerAborts; },
		get writerCommits() { return writerCommits; },
		writtenFrameCounts,
	};
}

interface TrackedAudioFile {
	readonly name: string;
	readonly type: string;
	readonly size: number;
	readonly ranges: Array<readonly [number, number]>;
	readonly wholeBodyReads: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	slice(start: number, end: number): Blob;
}

function trackedAudioFile(bytes: Uint8Array, name: string, type: string): TrackedAudioFile {
	const body = new Blob([Uint8Array.from(bytes)]);
	const ranges: Array<readonly [number, number]> = [];
	let wholeBodyReads = 0;
	return {
		name, type, size: body.size, ranges,
		get wholeBodyReads() { return wholeBodyReads; },
		async arrayBuffer() { wholeBodyReads += 1; return body.arrayBuffer(); },
		slice(start, end) { ranges.push([start, end]); return body.slice(start, end); },
	};
}

function aiff(sampleFormat: 'float32' | 'int16'): Uint8Array {
	const encoded = encodeAiff([
		Float32Array.of(-1, -0.5, 0, 0.5, 0.75),
		Float32Array.of(0.25, -0.25, 0.75, -0.75, 0),
	], { sampleRate: 48_000, sampleFormat, ...(sampleFormat === 'int16' ? { dither: 'none' as const } : {}) });
	assert.ok(encoded instanceof Uint8Array);
	return Uint8Array.from(encoded);
}

function pcmWav(): Uint8Array {
	const channelCount = 2;
	const frameCount = 5;
	const dataByteLength = channelCount * frameCount * Int16Array.BYTES_PER_ELEMENT;
	const bytes = new Uint8Array(44 + dataByteLength);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF'); view.setUint32(4, 36 + dataByteLength, true);
	writeAscii(bytes, 8, 'WAVE'); writeAscii(bytes, 12, 'fmt '); view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); view.setUint16(22, channelCount, true); view.setUint32(24, 48_000, true);
	view.setUint32(28, 48_000 * channelCount * 2, true); view.setUint16(32, channelCount * 2, true);
	view.setUint16(34, 16, true); writeAscii(bytes, 36, 'data'); view.setUint32(40, dataByteLength, true);
	return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}

function runtimeProxy<Runtime extends object>(values: Partial<Runtime>): Runtime {
	const noop = () => undefined;
	return new Proxy(values, {
		get(target, name) { return Reflect.has(target, name) ? Reflect.get(target, name) : noop; },
	}) as Runtime;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';
import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

test('short inspectable PCM WAVs stream without Web Audio', async () => {
	const fixture = createImportFixture();
	const result = await createProjectImportService(fixture.runtime).importFile(tinyPcmWav());

	assert.equal(result.destination, 'timeline');
	assert.equal(fixture.audioContextRequests(), 0);
	assert.deepEqual(fixture.activationOptions, [{ requireChunkStream: true }]);
	assert.equal(fixture.writerCommits(), 1);
});

test('malformed WAVs and unsupported media do not enter the PCM-only fallback', async () => {
	for (const input of [
		new File([Uint8Array.of(0, 1, 2, 3)], 'malformed.wav', { type: 'audio/wav' }),
		new File([Uint8Array.of(0, 1, 2, 3)], 'compressed.mp3', { type: 'audio/mpeg' }),
	]) {
		const fixture = createImportFixture();
		await assert.rejects(
			() => createProjectImportService(fixture.runtime).importFile(input),
			/Web Audio is not supported/iu,
		);
		assert.equal(fixture.audioContextRequests(), 1);
		assert.deepEqual(fixture.activationOptions, []);
		assert.equal(fixture.writerCommits(), 0);
	}
});

test('chunk-required short source activation never requests an AudioContext', async () => {
	let audioContextRequests = 0;
	const sourceChunkProviders = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const provider = Object.freeze({ id: 'short-source-provider' });
	const runtime = runtimeProxy<SourceLifecycleServiceRuntime>({
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32,
		createStoredChunkProvider: () => provider,
		engine: {
			getAudioContext: async () => {
				audioContextRequests += 1;
				throw new Error('Web Audio is not supported in this browser.');
			},
			setChunkSources: () => undefined,
		},
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		isStreamableStoredSource: () => true,
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		sourceBuffers: { delete: () => true },
		sourceChunkProviders,
		sourcePcmBytes: () => 16,
		sourcePeaks,
		store: {
			readSourceChunk: async () => ({ channels: [] }),
			saveAnalysis: async () => undefined,
		},
	});

	await createSourceLifecycleService(runtime).activateStoredSource(
		{ id: 'short-source', frameCount: 2, channelCount: 2, sampleRate: 48_000 },
		{ chunkCount: 1 },
		{ requireChunkStream: true },
	);

	assert.equal(audioContextRequests, 0);
	assert.strictEqual(sourceChunkProviders.get('short-source'), provider);
	assert.equal(sourcePeaks.has('short-source'), true);
});

function createImportFixture() {
	let nextId = 0;
	let contextRequests = 0;
	let commits = 0;
	const activationOptions: Array<Readonly<{ requireChunkStream?: boolean }>> = [];
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const project = {
		id: 'no-web-audio-project',
		metadata: { bext: null },
		tracks: [],
		sources: [],
	};
	const runtime = runtimeProxy<ProjectImportRuntime>({
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32,
		SOURCE_CHUNK_FRAMES: 2,
		activateStoredSource: async (
			_source: unknown,
			_metadata: unknown,
			options: Readonly<{ requireChunkStream?: boolean }>,
		) => { activationOptions.push(options); },
		commit: () => undefined,
		copy: {
			audioTrackNotFound: 'Audio track not found.',
			timelineFramesFinite: 'Frames must be finite.',
			track: 'Track',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		editingBlocked: () => false,
		engine: {
			getAudioContext: async () => {
				contextRequests += 1;
				throw new Error('Web Audio is not supported in this browser.');
			},
		},
		findTrack: () => null,
		getProject: () => project,
		inspectWavBlobPcm,
		isAudioEditorEngineSupported: () => false,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isLegacyBlockFile: () => false,
		isWavFile: (input: File) => input.name.endsWith('.wav'),
		preflightStorage: async () => undefined,
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async () => undefined,
		sourceBuffers,
		sourcePcmBytes: (descriptor: { frameCount?: number; channelCount?: number } | null) => (
			Number(descriptor?.frameCount) * Number(descriptor?.channelCount) * Float32Array.BYTES_PER_ELEMENT
		),
		sourcePeaks,
		store: {
			async beginSourceWrite() {
				return {
					abort: async () => undefined,
					commit: async () => { commits += 1; return { chunkCount: 1 }; },
					write: async () => undefined,
				};
			},
			deleteSource: async () => undefined,
		},
		streamWavBlobPcm,
		stripExtension: (name: string) => name.replace(/\.wav$/iu, ''),
		warnEnvelope: () => undefined,
	});
	return {
		activationOptions,
		audioContextRequests: () => contextRequests,
		runtime,
		writerCommits: () => commits,
	};
}

function tinyPcmWav(): File {
	const channelCount = 2;
	const frameCount = 2;
	const dataByteLength = channelCount * frameCount * Int16Array.BYTES_PER_ELEMENT;
	const bytes = new Uint8Array(44 + dataByteLength);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF');
	view.setUint32(4, 36 + dataByteLength, true);
	writeAscii(bytes, 8, 'WAVE');
	writeAscii(bytes, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, 48_000, true);
	view.setUint32(28, 48_000 * channelCount * Int16Array.BYTES_PER_ELEMENT, true);
	view.setUint16(32, channelCount * Int16Array.BYTES_PER_ELEMENT, true);
	view.setUint16(34, 16, true);
	writeAscii(bytes, 36, 'data');
	view.setUint32(40, dataByteLength, true);
	return new File([bytes], 'short-pcm.wav', { type: 'audio/wav' });
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}

function runtimeProxy<Runtime extends object>(values: Partial<Runtime>): Runtime {
	const noop = () => undefined;
	return new Proxy(values, {
		get(target, name) {
			if (Reflect.has(target, name)) return Reflect.get(target, name);
			return noop;
		},
	}) as Runtime;
}

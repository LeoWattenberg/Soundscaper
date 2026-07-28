/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectImportService } from '../src/common/editor/controller/project-import-service.ts';

interface RoutingFixture {
	readonly calls: string[];
	readonly runtime: Record<string, unknown>;
}

function signedFile(name: string, signature: 'RIFF' | 'RF64' | 'BW64') {
	const bytes = new TextEncoder().encode(`${signature} placeholder`);
	return {
		name,
		type: 'audio/wav',
		size: bytes.byteLength,
		async arrayBuffer() { return bytes.slice().buffer; },
		slice(start = 0, end = bytes.byteLength) {
			const part = bytes.slice(start, end);
			return { async arrayBuffer() { return part.buffer; } };
		},
	};
}

function createRoutingFixture(options: {
	readonly channelCount?: number;
	readonly inspectError?: Error;
} = {}): RoutingFixture {
	const calls: string[] = [];
	let nextId = 0;
	const project = { id: 'project', tracks: [], metadata: {} };
	const descriptor = {
		channelCount: options.channelCount ?? 1,
		frameCount: 2,
		sampleRate: 48_000,
		pcmBytes: 4 * (options.channelCount ?? 1),
		metadataWarnings: [],
		bext: null,
	};
	const writer = {
		async write() { calls.push('writer-write'); },
		async commit() { calls.push('writer-commit'); return {}; },
		async abort() { calls.push('writer-abort'); },
	};
	return {
		calls,
		runtime: {
			SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32 * 1024 ** 2,
			SOURCE_CHUNK_FRAMES: 65_536,
			activateStoredSource: async () => { calls.push('activate-source'); },
			commit: () => { calls.push('commit-command'); },
			copy: {
				audioTrackNotFound: 'Audio track not found.',
				timelineFramesFinite: 'Timeline frames must be finite.',
				track: 'Track',
			},
			createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
			createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
			createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
			createStableId: (prefix: string) => `${prefix}-${++nextId}`,
			editingBlocked: () => false,
			engine: {
				getAudioContext: async () => ({}),
				decodeAudioData: async () => { calls.push('native-decode'); return {}; },
			},
			ffmpeg: {
				decode: async () => { calls.push('ffmpeg-decode'); return {}; },
			},
			findTrack: () => null,
			getProject: () => project,
			inspectWavBlobPcm: async () => {
				calls.push('inspect-wav');
				if (options.inspectError) throw options.inspectError;
				return descriptor;
			},
			isAudioEditorVideoFile: () => false,
			isLegacyAupFile: () => false,
			isWavFile: () => true,
			preflightStorage: async () => { calls.push('preflight'); },
			projectSampleRate: () => 48_000,
			sourceBuffers: new Map(),
			sourceChunkProviders: new Map(),
			sourcePcmBytes: (value: { readonly pcmBytes: number }) => value.pcmBytes,
			sourcePeaks: new Map(),
			store: {
				beginSourceWrite: async () => writer,
				deleteSource: async () => undefined,
			},
			streamWavBlobPcm: async (_file: unknown, streamOptions: {
				onChunk(channels: Float32Array[]): Promise<unknown>;
			}) => {
				calls.push('stream-wav');
				await streamOptions.onChunk(Array.from(
					{ length: descriptor.channelCount },
					() => Float32Array.of(0, 0),
				));
			},
			stripExtension: (value: string) => value.replace(/\.[^.]+$/u, ''),
			warnEnvelope: () => undefined,
		},
	};
}

test('RF64 project imports always use the incremental native reader', async () => {
	const fixture = createRoutingFixture();
	const result = await createProjectImportService(fixture.runtime).importFile(
		signedFile('compact.rf64', 'RF64'),
	);
	assert.equal(result.destination, 'timeline');
	assert.equal(fixture.calls.includes('inspect-wav'), true);
	assert.equal(fixture.calls.includes('stream-wav'), true);
	assert.equal(fixture.calls.includes('writer-commit'), true);
	assert.equal(fixture.calls.includes('native-decode'), false);
	assert.equal(fixture.calls.includes('ffmpeg-decode'), false);
});

test('malformed RF64 and BW64 stop before browser or FFmpeg decoding', async () => {
	const malformed = createRoutingFixture({ inspectError: new Error('invalid RF64') });
	await assert.rejects(
		() => createProjectImportService(malformed.runtime).importFile(signedFile('broken.rf64', 'RF64')),
		/invalid RF64/u,
	);
	assert.equal(malformed.calls.includes('native-decode'), false);
	assert.equal(malformed.calls.includes('ffmpeg-decode'), false);

	const bw64 = createRoutingFixture({ inspectError: new Error('invalid BW64') });
	await assert.rejects(
		() => createProjectImportService(bw64.runtime).importFile(signedFile('broken.bw64', 'BW64')),
		/invalid BW64/u,
	);
	assert.equal(bw64.calls.includes('inspect-wav'), true);
	assert.equal(bw64.calls.includes('native-decode'), false);
	assert.equal(bw64.calls.includes('ffmpeg-decode'), false);
});

test('multichannel RF64 remains on the incremental native path', async () => {
	const fixture = createRoutingFixture({ channelCount: 6 });
	await createProjectImportService(fixture.runtime).importFile(signedFile('surround.rf64', 'RF64'));
	assert.equal(fixture.calls.includes('stream-wav'), true);
	assert.equal(fixture.calls.includes('native-decode'), false);
	assert.equal(fixture.calls.includes('ffmpeg-decode'), false);
});

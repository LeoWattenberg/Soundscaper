/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderExactAudioWarpPcm } from '../src/common/editor/audio-warp-render-parity.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createAiffStreamEncoder } from '../src/common/editor/aiff.js';
import { createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';
import { encodeAiff } from '../src/common/editor/aiff.js';

const SOURCE_PCM = Float32Array.from({ length: 9 }, (_value, frame) => frame / 8);
const EXPECTED_PCM = Float32Array.of(0, 0.0625, 0.125, 0.1875, 0.25, 0.4375, 0.625, 0.8125);

test('direct WAV export emits nonidentity exact-offline warp PCM at breakpoints and interiors', async () => {
	const project = warpProject();
	const written: Uint8Array[] = [];
	const errors: unknown[] = [];
	let renderedWindows = 0;
	let plannedStrategy = '';
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const prepared = Object.freeze({
		mode: 'stream' as const,
		async createWritable() {
			return new WritableStream<Uint8Array>({
				write(chunk) { written.push(chunk.slice()); },
			});
		},
		bytesWritten: () => written.reduce((total, chunk) => total + chunk.byteLength, 0),
		commit: () => Object.freeze({ fileName: 'warped.wav', method: 'filesystem', size: byteLength(written) }),
		abort() {},
	});
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping,
		cloneProject: (value: unknown) => structuredClone(value),
		copy: {
			localSourcesMissing: 'Missing sources', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createAiffStreamEncoder,
		createCacheAwareRenderEngine: () => createAudioEditorEngine({
			audioContextFactory: null,
			offlineAudioContextFactory: null,
			audioWarpRealtimeAcceleration: false,
			softwareRenderer: ({ project: renderProject, captureStartFrame, endFrame }) => {
				renderedWindows += 1;
				const exactProject = renderProject as ReturnType<typeof warpProject>;
				return {
					channels: renderExactAudioWarpPcm(
						exactProject,
						exactProject.clips[0]! as unknown as Parameters<typeof renderExactAudioWarpPcm>[1],
						{
							startFrame: Number(captureStartFrame), endFrame: Number(endFrame),
							sourceSampleRate: exactProject.sampleRate,
						},
						[SOURCE_PCM],
					),
					sampleRate: exactProject.sampleRate,
				};
			},
		}),
		createExportPlan: (value: Parameters<typeof createExportPlan>[0], options: Parameters<typeof createExportPlan>[1]) => {
			const plan = createExportPlan(value, options);
			plannedStrategy = plan.render.strategy;
			return plan;
		},
		createStableId: () => 'warp-export',
		createStreamingWindowedSincResampler,
		createTemporaryFileSink: () => { throw new Error('Direct WAV export must not stage a temporary file.'); },
		createWavStreamEncoder,
		encodeAiff,
		encodeWav,
		ffmpeg: { dispose() {} },
		fileService: {
			prepareSave: () => prepared,
			createDownload: () => { throw new Error('Direct WAV export must not create a download blob.'); },
		},
		getProject: () => project,
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => ({ signal: new AbortController().signal, assertCurrent() {}, finish() {} }),
			cancelTask() {},
		},
		normalizeExportSettings: (value: unknown) => value,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			renderSnapshot: () => { throw new Error('Force the production realtime fallback.'); },
		},
		preflightStorage: () => { throw new Error('Direct WAV export must not preflight temporary storage.'); },
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper',
		projectGeneration: { capture: () => 'warp-export', assertCurrent() {} },
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers: new Map(),
		state,
		store: {},
		throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw signal.reason; },
		toggleExport() {},
	};

	const result = await createEditorExportService(runtime).handleExportAction('export', {
		format: 'wav', mode: 'mix', range: 'project', includeTail: false,
		bitDepth: 32, floatingPoint: true, sampleFormat: 'float32', ditherMode: 'none',
	});
	assert.equal(plannedStrategy, 'offline', 'an ordinary offline failure selects the production fallback');
	assert.equal(renderedWindows, 1);
	assert.deepEqual(errors, []);
	assert.deepEqual(result, {
		url: null, fileName: 'warped.wav', mimeType: 'audio/wav',
		size: byteLength(written), method: 'filesystem',
	});
	assertSignal(decodeFloat32Wav(concatenate(written)), EXPECTED_PCM);
});

function warpProject() {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: SOURCE_PCM.length,
		channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', kind: 'audio', sourceId: source.id, anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 4, source: 2, mode: 'forward' },
			{ outer: 8, source: 8, mode: 'forward' },
		] },
	});
	return createAudioEditorProjectV17({
		id: 'warp-export-project', title: 'Warp export', now: '2026-08-12T12:00:00.000Z',
		sampleRate: 48_000, masterChannels: 1, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Warp', clipIds: [clip.id] }, 48_000)],
	});
}

function decodeFloat32Wav(bytes: Uint8Array): Float32Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(ascii(bytes, 0, 4), 'RIFF');
	assert.equal(ascii(bytes, 8, 12), 'WAVE');
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const id = ascii(bytes, offset, offset + 4);
		const size = view.getUint32(offset + 4, true);
		if (id === 'data') {
			assert.equal(size % Float32Array.BYTES_PER_ELEMENT, 0);
			return Float32Array.from(
				{ length: size / Float32Array.BYTES_PER_ELEMENT },
				(_value, index) => view.getFloat32(offset + 8 + index * Float32Array.BYTES_PER_ELEMENT, true),
			);
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error('Exported WAV has no data chunk.');
}

function assertSignal(actual: Float32Array, expected: Float32Array): void {
	assert.equal(actual.length, expected.length);
	for (let frame = 0; frame < expected.length; frame += 1) {
		assert.ok(Math.abs(actual[frame]! - expected[frame]!) <= 0.000_001, `frame ${String(frame)}`);
	}
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(byteLength(chunks));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}

function byteLength(chunks: readonly Uint8Array[]): number {
	return chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

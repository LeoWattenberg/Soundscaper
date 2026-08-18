/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const PRE_DATA = Uint8Array.of(0x63, 0x68, 0x6e, 0x61, 0, 0, 0, 0);
const TRAILING = Uint8Array.of(0x61, 0x78, 0x6d, 0x6c, 0, 0, 0, 0);
const BEXT = Object.freeze({ description: 'ADM master', version: 2 });

test('offline and realtime BW64 exports forward ADM chunks and retain six channels', async () => {
	const offline = harness('offline');
	const offlineOutput = await createEditorExportService(offline.runtime).handleExportAction('export');
	assert.equal(offlineOutput.mimeType, 'audio/wav');
	assert.equal(offline.planOptions[0]?.inputChannelCount, 2);
	assert.equal(offline.wavChannelCounts[0], 6);
	assert.equal(offline.renderProjects[0]?.masterChannels, 6);
	assert.equal((offline.renderProjects[0]?.metadata as { adm?: { mode?: string } })?.adm?.mode, 'authored');
	assertBw64Options(offline.wavOptions.at(-1));
	assert.deepEqual(offline.errors, []);

	const realtime = harness('realtime-stream');
	const realtimeOutput = await createEditorExportService(realtime.runtime).handleExportAction('export');
	assert.equal(realtimeOutput.mimeType, 'audio/wav');
	assert.equal(realtime.resamplerChannelCounts[0], 6);
	assert.equal(realtime.renderProjects[0]?.masterChannels, 6);
	assertBw64Options(realtime.streamOptions.at(-1));
	assert.deepEqual(realtime.errors, []);
});

function harness(strategy: 'offline' | 'realtime-stream') {
	const channels = Array.from({ length: 6 }, (_, channel) => Float32Array.of(channel / 10, 0));
	const audio = { sampleRate: 48_000, length: 2, numberOfChannels: 6, channels };
	const project = {
		id: 'project', title: 'ADM', sampleRate: 48_000, masterChannels: 2, metadata: { adm: null },
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		sources: [{ id: 'source' }],
	};
	const plan = {
		mode: 'mix', format: 'bw64', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 6,
		container: 'bw64', preDataChunks: PRE_DATA, trailingChunks: TRAILING, bext: BEXT,
		adm: { mode: 'authored', metadata: { mode: 'authored' } },
		encoding: { bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' },
		ditherMode: 'none', metadata: {}, markers: [], ixml: null, cart: null,
		render: { strategy }, range: { startFrame: 0, endFrame: 2, durationFrames: 2 },
		tailFrames: 0, outputFrames: 2, outputBytesPerRender: 48, outputFileBytesPerRender: 256,
		requiredTemporaryBytes: 256, outputs: [{ fileName: 'adm.wav', trackId: null }],
		channelMapping: { mode: 'preserve' }, archive: null,
	};
	const stagedBw64Bytes = () => encodeWav(
		Array.from({ length: plan.channelCount }, () => new Float32Array(plan.outputFrames)),
		{
			container: 'bw64', sampleRate: plan.sampleRate, bitDepth: 24, float: false, dither: 'none',
			bext: BEXT, preDataChunks: PRE_DATA, trailingChunks: TRAILING,
		},
	) as Uint8Array<ArrayBuffer>;
	const planOptions: Array<Record<string, unknown>> = [];
	const wavOptions: Array<Record<string, unknown>> = [];
	const wavChannelCounts: number[] = [];
	const streamOptions: Array<Record<string, unknown>> = [];
	const resamplerChannelCounts: number[] = [];
	const errors: unknown[] = [];
	const renderProjects: Array<Record<string, unknown>> = [];
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping: (value: Float32Array[]) => value,
		audioBufferChannels: (value: typeof audio) => value.channels,
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: {
			rendering: 'Rendering', encoding: 'Encoding', done: 'Done', localSourcesMissing: 'Missing',
			largeProjectRealtimeExport: 'Realtime', realtimeExportFallback: 'Fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createCacheAwareRenderEngine: () => ({
			loadProject: (value: Record<string, unknown>) => { renderProjects.push(value); },
			renderMixRealtime: async ({ onChunk }: { onChunk(value: Float32Array[], metadata: object): void }) => {
				onChunk(channels, { sampleRate: 48_000 });
				return { sampleRate: 48_000 };
			},
			dispose: async () => undefined,
		}),
		createExportPlan: (_project: unknown, options: Record<string, unknown>) => {
			planOptions.push(options);
			return plan;
		},
		createStableId: () => 'stable',
		createStreamingWindowedSincResampler: (_input: number, _output: number, channelCount: number) => {
			resamplerChannelCounts.push(channelCount);
			return { push: (value: Float32Array[]) => value, finish: () => channels.map(() => new Float32Array()) };
		},
		createTemporaryFileSink: async () => ({
			persistent: true, write: async () => undefined,
			close: async () => new Blob([stagedBw64Bytes()], { type: 'audio/wav' }),
			remove: async () => undefined, abort: async () => undefined,
		}),
		createWavStreamEncoder: (options: Record<string, unknown>) => {
			streamOptions.push(options);
			return { write: () => undefined, finalize: () => undefined, settled: async () => undefined };
		},
		// The real encoder: a BW64 delivery is conformed by reopening the file it
		// wrote, and a stub byte is the writer fault conformance exists to catch.
		encodeWav: (value: Float32Array[], options: Record<string, unknown>) => {
			wavChannelCounts.push(value.length);
			wavOptions.push(options);
			return encodeWav(value, options as never);
		},
		fileService: {
			createDownload: async ({ suggestedName }: { suggestedName: string }) => ({
				cancelled: false, url: 'blob:result', fileName: suggestedName, method: 'memory', cleanup: async () => undefined,
			}),
		},
		ffmpeg: {}, getProject: () => project, handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => ({ signal: new AbortController().signal, assertCurrent: () => undefined, finish: () => undefined }),
			cancelTask: () => undefined,
		},
		normalizeExportSettings: (value: unknown) => value,
		normalizeProjectSampleRate: (value: number) => value,
		options: { renderSnapshot: async (value: Record<string, unknown>) => {
			renderProjects.push(value);
			return audio;
		} },
		preflightStorage: async () => undefined, prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper', projectGeneration: { capture: () => 'token', assertCurrent: () => undefined },
		publishDocumentSnapshot: () => undefined, setStatus: () => undefined, sourceBuffers: new Map(), state,
		throwIfAborted: () => undefined, toggleExport: () => undefined, updateExportProgress: () => undefined,
	};
	return { runtime, planOptions, wavOptions, wavChannelCounts, streamOptions, resamplerChannelCounts, renderProjects, errors };
}

function assertBw64Options(options: Record<string, unknown> | undefined): void {
	assert.equal(options?.container, 'bw64');
	if (Object.hasOwn(options ?? {}, 'channelCount')) assert.equal(options?.channelCount, 6);
	assert.deepEqual(options?.preDataChunks, PRE_DATA);
	assert.deepEqual(options?.trailingChunks, TRAILING);
	assert.deepEqual(options?.bext, BEXT);
}

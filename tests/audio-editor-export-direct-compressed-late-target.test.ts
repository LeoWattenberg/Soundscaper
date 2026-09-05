/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encodeDirectCompressedStagedFile,
	prepareDirectCompressedDestination,
	type DirectCompressedPlan,
} from '../src/common/editor/controller/direct-compressed-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';

// A desktop save target expires 15 minutes after the native dialog registers it
// and cannot be renewed, so a target chosen before the render is spent by the
// render: a long compressed export finished encoding and then lost its
// destination. Desktop selection therefore has to happen where the video route
// already puts it — when FFmpeg opens the sink, after the encode has stat-ed
// its output.

test('a desktop compressed export chooses its target only when FFmpeg opens the sink', async () => {
	const plan = compressedPlan();
	const events: string[] = [];
	const target = preparedTarget(plan.outputs[0]!.fileName, events);
	const signal = new AbortController().signal;

	const preparation = await prepareDirectCompressedDestination({
		isDesktop: true,
		prepareSave() { events.push('picker'); return target; },
	}, plan, null, signal);

	assert.ok(preparation.destination, 'the desktop route still prepares a direct destination');
	assert.equal(events.length, 0, 'the native save dialog must not run before the render');

	const encoded = await encodeDirectCompressedStagedFile({
		destination: preparation.destination,
		plan,
		stagedFile: new Blob([Uint8Array.of(0)], { type: 'audio/wav' }),
		encodingSettings: plan.encoding ?? {},
		signal,
		assertCurrent: () => undefined,
		cleanupStagedFile: () => { events.push('staging:cleanup'); },
		ffmpeg: {
			async encodeFileToSink(_file, _format, sink, _settings) {
				events.push('ffmpeg:stat');
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2));
				await sink.write(Uint8Array.of(3, 4, 5));
				const output = await sink.close();
				return { output, byteLength: 5, chunkCount: 2, extension: '.mp3', mimeType: 'audio/mpeg' };
			},
		},
	});

	assert.equal(encoded.byteLength, 5);
	assert.deepEqual(
		events,
		['ffmpeg:stat', 'picker', 'target:open', 'target:close', 'staging:cleanup'],
		'the dialog belongs between the FFmpeg stat and the target open',
	);
	assert.equal(target.opens(), 1);
	assert.equal(target.aborts(), 0);
});

test('a browser compressed export still chooses its target before the render', async () => {
	const plan = compressedPlan();
	const events: string[] = [];
	const target = preparedTarget(plan.outputs[0]!.fileName, events);

	const preparation = await prepareDirectCompressedDestination({
		prepareSave() { events.push('picker'); return target; },
	}, plan, null, new AbortController().signal);

	assert.ok(preparation.destination);
	assert.deepEqual(events, ['picker'], 'a File System Access handle does not expire and is taken up front');
});

test('a desktop compressed export renders before its save dialog and publishes what it encoded', async () => {
	const fixture = serviceFixture('stream');

	const result = await createEditorExportService(fixture.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3', bitRate: 320 },
	);

	assert.deepEqual(fixture.errors, []);
	assert.equal(result.size, 5);
	assert.equal(result.mimeType, 'audio/mpeg');
	assertOrdered(fixture.events, 'render:realtime', 'picker');
	assertOrdered(fixture.events, 'ffmpeg:stat', 'picker');
	assertOrdered(fixture.events, 'picker', 'target:open');
	assert.equal(fixture.target.commits(), 1);
});

test('a desktop save dialog cancelled after the encode ends the export without an error', async () => {
	const fixture = serviceFixture('cancelled');

	const result = await createEditorExportService(fixture.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3', bitRate: 320 },
	);

	assert.deepEqual(fixture.errors, [], 'dismissing the save dialog is not an export failure');
	assert.equal(result.cancelled, true);
	assert.equal(fixture.events.includes('render:realtime'), true, 'the render ran before the dialog');
	assert.equal(fixture.events.includes('target:open'), false);
	assert.equal(fixture.events.includes('staging:remove'), true, 'the staged WAV is released');
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('done'), false);
});

function compressedPlan(): DirectCompressedPlan & { readonly outputs: readonly { readonly fileName: string }[] } {
	return createExportPlan(realtimeProject(), {
		mode: 'mix', format: 'mp3', includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		metadata: { artist: 'Codex' }, date: '2026-08-02', bitRate: 320,
	}) as unknown as DirectCompressedPlan & { readonly outputs: readonly { readonly fileName: string }[] };
}

function preparedTarget(fileName: string, events: string[]) {
	let byteLength = 0;
	let openCount = 0;
	let abortCount = 0;
	let commitCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable() {
			openCount += 1;
			events.push('target:open');
			return new WritableStream<Uint8Array>({
				write(chunk) { byteLength += chunk.byteLength; },
				close() { events.push('target:close'); },
			});
		},
		bytesWritten: () => byteLength,
		async commit() { commitCount += 1; events.push('target:commit'); return { method: 'memory', fileName, size: byteLength }; },
		async abort() { abortCount += 1; events.push('target:abort'); },
		opens: () => openCount,
		aborts: () => abortCount,
		commits: () => commitCount,
	};
}

function serviceFixture(mode: 'stream' | 'cancelled') {
	const plan = compressedPlan() as unknown as {
		channelCount: number;
		encoding: Record<string, unknown> & { extension: string };
		format: string;
		mimeType: string;
		outputs: Array<{ fileName: string }>;
	};
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const target = preparedTarget(plan.outputs[0]!.fileName, events);
	const project = realtimeProject();
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	let taskController: AbortController | null = null;
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping,
		audioBufferChannels: (audio: Readonly<{ channels: readonly Float32Array[] }>) => audio.channels,
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: {
			localSourcesMissing: 'missing', rendering: 'rendering', encoding: 'encoding', done: 'done',
			largeProjectRealtimeExport: 'realtime', realtimeExportFallback: 'fallback',
			realtimeStorageRequired: 'storage required',
		},
		createAiffStreamEncoder: () => { throw new Error('unexpected AIFF encoder'); },
		createCacheAwareRenderEngine: () => ({
			loadProject: () => undefined,
			async renderMixRealtime(renderOptions: Readonly<Record<string, unknown>>) {
				events.push('render:realtime');
				const onChunk = renderOptions.onChunk as (
					channels: readonly Float32Array[], metadata: Readonly<Record<string, unknown>>,
				) => PromiseLike<unknown> | unknown;
				await onChunk([Float32Array.of(0.1), Float32Array.of(0.2)], { sampleRate: 48_000 });
			},
			dispose: async () => { events.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: async () => { throw new Error('unexpected stem archive'); },
		createStreamingWindowedSincResampler: (
			_inputRate: number, _outputRate: number, channelCount: number,
		) => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => Array.from({ length: channelCount }, () => new Float32Array(0)),
		}),
		createTemporaryFileSink: async () => ({
			persistent: true,
			write: async () => { events.push('staging:write'); },
			close: async () => { events.push('staging:close'); return new Blob([Uint8Array.of(0)], { type: 'audio/wav' }); },
			remove: async () => { events.push('staging:remove'); },
			abort: async () => { events.push('staging:abort'); },
		}),
		createWavStreamEncoder: (settings: Readonly<Record<string, unknown>>) => {
			const pending: Promise<unknown>[] = [];
			const onChunk = settings.onChunk as (chunk: Uint8Array) => PromiseLike<unknown> | unknown;
			return {
				write: () => { pending.push(Promise.resolve(onChunk(Uint8Array.of(0)))); },
				finalize: () => undefined,
				settled: async () => { await Promise.all(pending); },
			};
		},
		encodeAiff: () => { throw new Error('unexpected offline AIFF'); },
		encodeWav: () => { throw new Error('unexpected offline WAV'); },
		ffmpeg: {
			dispose: () => { events.push('ffmpeg:dispose'); },
			encode: async () => ({ bytes: Uint8Array.of(1), mimeType: plan.mimeType }),
			encodeFile: async () => { throw new Error('unexpected buffered encode'); },
			async encodeFileToSink(
				_file: Blob, _format: string, sink: FfmpegOutputSink<unknown>,
				settings: Readonly<Record<string, unknown>>,
			) {
				events.push('ffmpeg:stat');
				(settings.assertCurrent as () => void)();
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2));
				await sink.write(Uint8Array.of(3, 4, 5));
				const output = await sink.close();
				events.push('ffmpeg:cleanup');
				return {
					output, byteLength: 5, chunkCount: 2,
					extension: `.${plan.encoding.extension}`, mimeType: plan.mimeType,
				};
			},
		},
		fileService: {
			isDesktop: true,
			prepareSave: () => {
				events.push('picker');
				return mode === 'stream' ? target : { mode: 'cancelled', cancelled: true };
			},
			createDownload: async () => { throw new Error('unexpected browser download'); },
		},
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => {
				taskController = new AbortController();
				return { signal: taskController.signal, assertCurrent: () => undefined, finish: () => undefined };
			},
			cancelTask: () => { taskController?.abort(); },
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {}, playbackProjects: null,
		preflightStorage: async () => undefined,
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper', getProject: () => project,
		projectGeneration: { capture: () => 'token', assertCurrent: () => undefined },
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: async () => { throw new Error('unexpected resample'); },
		setStatus: (status: string) => { statuses.push(status); },
		sourceBuffers: new Map(), state,
		stemProject: () => { throw new Error('unexpected stems'); }, store: {},
		taskProgress: { begin: () => ({ setPhase: () => true, finish: () => true }), setActivePhase: () => true },
		throwIfAborted: (signal?: AbortSignal | null) => { if (signal?.aborted) throw abortError(); },
		toggleExport: () => undefined,
		updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('unexpected fallback'); },
	};
	return { errors, events, plan, runtime, state, statuses, target };
}

function assertOrdered(events: readonly string[], before: string, after: string): void {
	assert.ok(events.includes(before), `${before} must happen`);
	assert.ok(events.includes(after), `${after} must happen`);
	assert.ok(events.indexOf(before) < events.indexOf(after), `${before} must precede ${after}: ${events.join(' ')}`);
}

function realtimeProject() {
	return {
		schemaVersion: 9, id: 'direct-compressed-late-target-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 1 }, loop: { enabled: false, startFrame: 0, endFrame: 1 },
		sources: [{ id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav', frameCount: 1, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitDirectMp3Destination,
	directMp3StagingTemporaryBytes,
	encodeDirectMp3StagedFile,
	prepareDirectMp3Destination,
} from '../src/common/editor/controller/direct-mp3-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';

test('direct MP3 admission accepts the canonical realtime export plan', () => {
	const durationFrames = 33_685_504;
	const plan = createExportPlan(realtimeProject(durationFrames), {
		mode: 'mix', format: 'mp3', includeTail: false, livePcmBytes: 0,
	});
	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'offline-render-output-memory');
	assert.equal(directMp3StagingTemporaryBytes(plan), durationFrames * 2 * 4);
});

test('direct MP3 prepares before render, opens lazily from stat, streams exactly, then commits', async () => {
	const plan = eligiblePlan();
	const events: string[] = [];
	const prepared = preparedStream({ events });
	const signal = new AbortController().signal;
	const preparation = await prepareDirectMp3Destination({
		prepareSave(request) {
			events.push('picker');
			assert.deepEqual(request, {
				purpose: 'audio',
				suggestedName: 'session-mix.mp3',
				mimeType: 'audio/mpeg',
				target: { id: 'target' },
				types: [{ description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } }],
				useFileSystemAccess: false,
				signal,
			});
			return prepared;
		},
	}, plan, { saveTarget: { id: 'target' }, useFileSystemAccess: false }, signal);
	assert.ok(preparation.destination);
	assert.equal(prepared.opens(), 0);
	assert.equal(directMp3StagingTemporaryBytes(plan), 8);

	const stagedFile = new Blob([Uint8Array.of(0, 1)], { type: 'audio/wav' });
	let currentChecks = 0;
	let stagedCleanups = 0;
	const encoded = await encodeDirectMp3StagedFile({
		destination: preparation.destination,
		plan,
		stagedFile,
		cleanupStagedFile: async () => { stagedCleanups += 1; events.push('staging:cleanup'); },
		ffmpeg: {
			async encodeFileToSink(file, format, sink, settings) {
				assert.strictEqual(file, stagedFile);
				assert.equal(format, 'mp3');
				assert.strictEqual(settings.signal, signal);
				events.push('ffmpeg:stat');
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2));
				await sink.write(Uint8Array.of(3, 4, 5));
				const output = await sink.close();
				return { output, byteLength: 5, chunkCount: 2, extension: '.mp3', mimeType: 'audio/mpeg' };
			},
		},
		encodingSettings: { bitRate: 192 },
		signal,
		assertCurrent: () => { currentChecks += 1; },
	});
	assert.equal(encoded.byteLength, 5);
	assert.equal(encoded.mimeType, 'audio/mpeg');
	assert.strictEqual(encoded.directDestination, preparation.destination);
	assert.equal(stagedCleanups, 1);
	assert.ok(currentChecks > 1);
	assert.ok(events.indexOf('picker') < events.indexOf('ffmpeg:stat'));
	assert.ok(events.indexOf('ffmpeg:stat') < events.indexOf('target:open:5:exact'));
	assert.equal(events.at(-2), 'target:close');
	assert.equal(events.at(-1), 'staging:cleanup');

	const published = await commitDirectMp3Destination(
		preparation.destination, plan, encoded.byteLength, () => { events.push('current:commit'); },
	);
	assert.deepEqual(published, { method: 'memory', fileName: 'session-mix.mp3', size: 5 });
	assert.ok(events.indexOf('target:close') < events.indexOf('target:commit'));
	assert.equal(prepared.bytes().byteLength, 5);
});

test('direct MP3 cancellation and ineligible plans never open a target', async () => {
	const cancellation = Object.freeze({ mode: 'cancelled' as const, cancelled: true });
	const cancelled = await prepareDirectMp3Destination(
		{ prepareSave: () => cancellation }, eligiblePlan(), null, new AbortController().signal,
	);
	assert.strictEqual(cancelled.cancelled, cancellation);
	assert.equal(cancelled.destination, null);

	for (const plan of ineligiblePlans()) {
		let pickerCalls = 0;
		const result = await prepareDirectMp3Destination({
			prepareSave() { pickerCalls += 1; return preparedStream(); },
		}, plan, null, new AbortController().signal);
		assert.equal(pickerCalls, 0, plan.label);
		assert.equal(result.destination, null, plan.label);
		assert.equal(directMp3StagingTemporaryBytes(plan), null, plan.label);
	}
});

test('direct MP3 failures clean staging and abort the unpublished target exactly once', async () => {
	for (const failure of ['write', 'result', 'cleanup', 'drift'] as const) {
		const plan = eligiblePlan();
		const prepared = preparedStream({ writeError: failure === 'write' ? new Error('write failed') : undefined });
		const preparation = await prepareDirectMp3Destination(
			{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
		);
		assert.ok(preparation.destination);
		let stagedCleanups = 0;
		const error = await encodeDirectMp3StagedFile({
			destination: preparation.destination,
			plan,
			stagedFile: new Blob([Uint8Array.of(0)], { type: 'audio/wav' }),
			cleanupStagedFile: async () => {
				stagedCleanups += 1;
				if (failure === 'cleanup') throw new Error('staging cleanup failed');
			},
			ffmpeg: fakeFfmpeg(async (sink) => {
				if (failure === 'drift') plan.outputs[0]!.fileName = 'changed.mp3';
				await sink.open(3);
				await sink.write(Uint8Array.of(1, 2, 3));
				const output = await sink.close();
				return {
					output,
					byteLength: failure === 'result' ? 2 : 3,
					chunkCount: 1,
					extension: '.mp3',
					mimeType: 'audio/mpeg',
				};
			}),
			encodingSettings: {},
			signal: new AbortController().signal,
			assertCurrent: () => undefined,
		}).then(() => null, (caught: unknown) => caught);
		assert.ok(error instanceof Error);
		assert.equal(stagedCleanups, 1);
		assert.equal(prepared.aborts(), 1);
		assert.equal(prepared.commits(), 0);
	}
});

test('direct MP3 plan drift and byte-count drift refuse commit', async () => {
	const plan = eligiblePlan();
	const prepared = preparedStream();
	const preparation = await prepareDirectMp3Destination(
		{ prepareSave: () => prepared }, plan, null, new AbortController().signal,
	);
	assert.ok(preparation.destination);
	const encoded = await encodeDirectMp3StagedFile({
		destination: preparation.destination,
		plan,
		stagedFile: new Blob([Uint8Array.of(0)], { type: 'audio/wav' }),
		cleanupStagedFile: async () => undefined,
		ffmpeg: fakeFfmpeg(async (sink) => {
			await sink.open(3);
			await sink.write(Uint8Array.of(1, 2, 3));
			const output = await sink.close();
			return { output, byteLength: 3, chunkCount: 1, extension: '.mp3', mimeType: 'audio/mpeg' };
		}),
		encodingSettings: {},
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
	});
	await assert.rejects(
		async () => commitDirectMp3Destination(preparation.destination!, plan, encoded.byteLength - 1, () => undefined),
		/emitted byte count/iu,
	);
	plan.outputs[0]!.fileName = 'changed.mp3';
	await assert.rejects(
		async () => commitDirectMp3Destination(preparation.destination!, plan, encoded.byteLength, () => undefined),
		/plan changed/iu,
	);
	assert.equal(prepared.commits(), 0);
	await preparation.destination.abort();
	assert.equal(prepared.aborts(), 1);
});

test('export service selects before realtime render and publishes direct MP3 without Blob fallback', async () => {
	const fixture = serviceFixture('stream');
	const result = await createEditorExportService(fixture.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3' },
	);
	assert.deepEqual(fixture.errors, []);
	assert.deepEqual(result, {
		url: null, fileName: 'session-mix.mp3', mimeType: 'audio/mpeg', size: 5, method: 'memory',
	});
	assert.deepEqual(fixture.preflightBytes, [8]);
	assert.ok(fixture.events.indexOf('picker') < fixture.events.indexOf('render:realtime'));
	assert.ok(fixture.events.indexOf('staging:close') < fixture.events.indexOf('ffmpeg:stat'));
	assert.ok(fixture.events.indexOf('ffmpeg:stat') < fixture.events.indexOf('target:open:5:exact'));
	assert.ok(fixture.events.indexOf('ffmpeg:cleanup') < fixture.events.indexOf('staging:remove'));
	assert.ok(fixture.events.indexOf('target:close') < fixture.events.indexOf('target:commit'));
	assert.equal(fixture.events.includes('ffmpeg:encode-file'), false);
	assert.equal(fixture.events.includes('ffmpeg:encode-bytes'), false);
	assert.equal(fixture.downloads.length, 0);
	assert.equal(fixture.target.opens(), 1);
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
});

test('export service preserves MP3 chooser cancellation and prepared-Blob fallback', async () => {
	const cancelled = serviceFixture('cancelled');
	const cancellation = await createEditorExportService(cancelled.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3' },
	);
	assert.equal(cancellation.cancelled, true);
	assert.deepEqual(cancelled.preflightBytes, []);
	assert.equal(cancelled.events.some((event) => event.startsWith('render:')), false);
	assert.equal(cancelled.events.some((event) => event.startsWith('ffmpeg:')), false);

	const fallback = serviceFixture('blob');
	const result = await createEditorExportService(fallback.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3' },
	);
	assert.equal(result.mimeType, 'audio/mpeg');
	assert.deepEqual(fallback.preflightBytes, [8]);
	assert.equal(fallback.events.includes('ffmpeg:encode-file'), true);
	assert.equal(fallback.events.includes('ffmpeg:stat'), false);
	assert.equal(fallback.events.includes('staging:remove'), true);
	assert.equal(fallback.downloads.length, 1);
	assert.ok(fallback.downloads[0]?.blob instanceof Blob);
});

test('direct MP3 retains nonpersistent staging refusal above 96 MiB', async () => {
	const fixture = serviceFixture('stream', { persistent: false });
	const byteLength = 97 * 1024 ** 2;
	fixture.plan.outputFrames = byteLength / 8;
	fixture.plan.outputBytesPerRender = byteLength;
	fixture.plan.requiredTemporaryBytes = byteLength;
	fixture.plan.range.endFrame = fixture.plan.outputFrames;
	fixture.plan.range.durationFrames = fixture.plan.outputFrames;
	fixture.plan.render.totalBytes += byteLength - fixture.plan.render.outputBytes;
	fixture.plan.render.outputBytes = byteLength;
	assert.equal(await createEditorExportService(fixture.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'mp3' },
	), undefined);
	assert.deepEqual(fixture.preflightBytes, [byteLength]);
	assert.equal(fixture.events.includes('staging:abort'), true);
	assert.equal(fixture.events.includes('render:realtime'), false);
	assert.equal(fixture.events.includes('ffmpeg:stat'), false);
	assert.equal(fixture.target.opens(), 0);
	assert.equal(fixture.target.aborts(), 1);
	assert.match(String(fixture.errors[0]), /storage required/iu);
});

test('late cancellation during direct MP3 commit returns the file without stale success UI', async () => {
	const commitStarted = deferred<void>();
	const releaseCommit = deferred<void>();
	const fixture = serviceFixture('stream', {
		onCommit: async () => { commitStarted.resolve(); await releaseCommit.promise; },
	});
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export', { mode: 'mix', format: 'mp3' });
	await commitStarted.promise;
	await service.handleExportAction('cancel');
	releaseCommit.resolve();
	const result = await saving;
	assert.equal(result.size, 5);
	assert.equal(result.mimeType, 'audio/mpeg');
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('done'), false);
});

function eligiblePlan() {
	return {
		mode: 'mix', format: 'mp3', mimeType: 'audio/mpeg',
		sampleRate: 48_000, channelCount: 2, outputFrames: 1,
		outputBytesPerRender: 8, outputFileBytesPerRender: null, requiredTemporaryBytes: 8,
		dither: false, ditherMode: 'none', metadata: {}, channelMapping: {
			inputChannelCount: 2, outputChannelCount: 2, mode: 'preserve',
			channels: [{ inputs: [{ channel: 0, gain: 1 }] }, { inputs: [{ channel: 1, gain: 1 }] }],
		},
		encoding: {
			format: 'mp3', backend: 'ffmpeg', extension: 'mp3', mimeType: 'audio/mpeg',
			sampleRate: 48_000, inputChannelCount: 2, channelCount: 2,
			channelMapping: {
				inputChannelCount: 2, outputChannelCount: 2, mode: 'preserve',
				channels: [{ inputs: [{ channel: 0, gain: 1 }] }, { inputs: [{ channel: 1, gain: 1 }] }],
			},
			sampleFormat: null, bitDepth: null, floatingPoint: false,
			dither: 'none', metadata: {}, bitRate: 192,
		},
		render: {
			strategy: 'realtime-stream', fast: false, reason: 'total-memory',
			outputBytes: 8, livePcmBytes: 2 * 1024 ** 3, totalBytes: 2 * 1024 ** 3 + 8,
			thresholds: { outputBytes: 384 * 1024 ** 2, totalBytes: 1024 * 1024 ** 2 },
		},
		range: { startFrame: 0, endFrame: 1, durationFrames: 1 }, tailFrames: 0,
		outputs: [{
			kind: 'mix', fileName: 'session-mix.mp3', trackId: null,
			includeMaster: true, respectMuteSolo: true,
		}],
		archive: null,
	};
}

function realtimeProject(durationFrames: number) {
	return {
		schemaVersion: 9, id: 'direct-mp3-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: durationFrames, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { effectsActive: true, effects: [] },
	};
}

function ineligiblePlans(): Array<ReturnType<typeof eligiblePlan> & { label: string }> {
	const base = eligiblePlan();
	return [
		{ ...base, label: 'offline', render: { ...base.render, strategy: 'offline' } },
		{ ...base, label: 'stems', mode: 'stems' },
		{ ...base, label: 'other codec', format: 'flac' },
		{ ...base, label: 'wrong MIME', mimeType: 'audio/mp3' },
		{
			...base, label: 'wrong filename',
			outputs: [{ ...base.outputs[0]!, fileName: 'session-mix.wav' }],
		},
		{ ...base, label: 'inexact staging geometry', outputBytesPerRender: 7 },
		{ ...base, label: 'file-size claim', outputFileBytesPerRender: 5 },
		{ ...base, label: 'archive route', archive: {} },
	] as Array<ReturnType<typeof eligiblePlan> & { label: string }>;
}

type PrepareMode = 'stream' | 'blob' | 'cancelled';

function serviceFixture(mode: PrepareMode, options: Readonly<{
	persistent?: boolean;
	onCommit?: () => PromiseLike<void> | void;
}> = {}) {
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const preflightBytes: number[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const plan = eligiblePlan();
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const target = preparedStream({ events, onCommit: options.onCommit });
	const project = {
		id: 'project', title: 'Session', sampleRate: 48_000, masterChannels: 2,
		tracks: [], clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }], sources: [],
	};
	let taskController: AbortController | null = null;
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => { if (signal?.aborted) throw abortError(); };
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
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
					channels: Float32Array[], metadata: Readonly<Record<string, unknown>>,
				) => PromiseLike<unknown> | unknown;
				await onChunk([Float32Array.of(0.1), Float32Array.of(0.2)], { sampleRate: 48_000 });
			},
			dispose: async () => { events.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: async () => { throw new Error('unexpected stem archive'); },
		createStreamingWindowedSincResampler: () => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => [new Float32Array(0), new Float32Array(0)],
		}),
		createTemporaryFileSink: async () => ({
			persistent: options.persistent !== false,
			write: async () => { events.push('staging:write'); },
			close: async () => {
				events.push('staging:close');
				return new Blob([Uint8Array.of(0)], { type: 'audio/wav' });
			},
			remove: async () => { events.push('staging:remove'); },
			abort: async () => { events.push('staging:abort'); },
		}),
		createWavStreamEncoder: (encoderOptions: Readonly<Record<string, unknown>>) => {
			const pending: Promise<unknown>[] = [];
			const onChunk = encoderOptions.onChunk as (chunk: Uint8Array) => PromiseLike<unknown> | unknown;
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
			encode: async () => { events.push('ffmpeg:encode-bytes'); return { bytes: Uint8Array.of(1), mimeType: 'audio/mpeg' }; },
			encodeFile: async () => {
				events.push('ffmpeg:encode-file');
				return { bytes: Uint8Array.of(1, 2, 3), mimeType: 'audio/mpeg' };
			},
			async encodeFileToSink(
				_file: Blob,
				_format: string,
				sink: FfmpegOutputSink<unknown>,
				settings: Readonly<Record<string, unknown>>,
			) {
				events.push('ffmpeg:stat');
				(settings.assertCurrent as () => void)();
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2));
				await sink.write(Uint8Array.of(3, 4, 5));
				const output = await sink.close();
				events.push('ffmpeg:cleanup');
				return { output, byteLength: 5, chunkCount: 2, extension: '.mp3', mimeType: 'audio/mpeg' };
			},
		},
		fileService: {
			prepareSave: () => {
				events.push('picker');
				if (mode === 'stream') return target;
				if (mode === 'cancelled') return { mode: 'cancelled', cancelled: true };
				return { mode: 'blob' };
			},
			createDownload: async (request: Readonly<Record<string, unknown>>) => {
				downloads.push(request);
				return { cancelled: false, url: 'blob:fallback', method: 'memory', cleanup: async () => undefined };
			},
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
		preflightStorage: async (bytes: number) => { preflightBytes.push(bytes); },
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper', getProject: () => project,
		projectGeneration: { capture: () => 'token', assertCurrent: () => undefined },
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: async () => { throw new Error('unexpected resample'); },
		setStatus: (status: string) => { statuses.push(status); },
		sourceBuffers: new Map(), state,
		stemProject: () => { throw new Error('unexpected stems'); }, store: {},
		taskProgress: { begin: () => ({ setPhase: () => true, finish: () => true }), setActivePhase: () => true },
		throwIfAborted, toggleExport: () => undefined, updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('unexpected fallback'); },
	};
	return { downloads, errors, events, plan, preflightBytes, runtime, state, statuses, target };
}

function preparedStream(options: Readonly<{
	events?: string[];
	writeError?: Error;
	onCommit?: () => PromiseLike<void> | void;
}> = {}) {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let openCount = 0;
	let abortCount = 0;
	let commitCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable(exactByteLength: number, sizeMode: string) {
			openCount += 1;
			options.events?.push(`target:open:${exactByteLength}:${sizeMode}`);
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.writeError) throw options.writeError;
					chunks.push(chunk.slice());
					byteLength += chunk.byteLength;
				},
				close() { options.events?.push('target:close'); },
			});
		},
		bytesWritten: () => byteLength,
		async commit() {
			commitCount += 1;
			options.events?.push('target:commit');
			await options.onCommit?.();
			return { method: 'memory', fileName: 'session-mix.mp3', size: byteLength };
		},
		abort: async () => { abortCount += 1; options.events?.push('target:abort'); },
		opens: () => openCount,
		aborts: () => abortCount,
		commits: () => commitCount,
		bytes: () => Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
	};
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value?: Value | PromiseLike<Value>) => void;
} {
	let resolve!: (value?: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept as typeof resolve; });
	return { promise, resolve };
}

function fakeFfmpeg(
	operation: (sink: FfmpegOutputSink<unknown>) => Promise<Readonly<Record<string, unknown>>>,
) {
	return {
		async encodeFileToSink(
			_file: Blob,
			_format: string,
			sink: FfmpegOutputSink<unknown>,
		): Promise<Readonly<Record<string, unknown>>> {
			try {
				return await operation(sink);
			} catch (error) {
				await sink.abort(error);
				throw error;
			}
		},
	};
}

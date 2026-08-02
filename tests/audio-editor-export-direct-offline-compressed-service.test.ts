/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	directCompressedStagingTemporaryBytes,
	type DirectCompressedFormat,
} from '../src/common/editor/controller/direct-compressed-export.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';

const FORMAT_CASES: readonly Readonly<{
	format: DirectCompressedFormat;
	options: Readonly<Record<string, unknown>>;
}>[] = Object.freeze([
	{ format: 'mp3', options: { bitRate: 320, channelMapping: 'mono' } },
	{ format: 'flac', options: { sampleFormat: 'int16', dither: 'triangular-highpass' } },
	{ format: 'ogg-vorbis', options: { quality: 7 } },
	{ format: 'opus', options: { bitRate: 192 } },
	{ format: 'wavpack', options: { sampleFormat: 'int24', dither: 'triangular' } },
	{ format: 'mp2', options: { bitRate: 384 } },
	{ format: 'aac-m4a', options: { bitRate: 256 } },
]);

test('actual offline plans for all compressed formats stage then publish directly', async () => {
	for (const entry of FORMAT_CASES) {
		const fixture = serviceFixture(entry.format, entry.options);
		const result = await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { format: entry.format, ...entry.options },
		);
		assert.deepEqual(fixture.errors, [], entry.format);
		assert.deepEqual(result, {
			url: null,
			fileName: fixture.plan.outputs[0].fileName,
			mimeType: fixture.plan.mimeType,
			size: 5,
			method: 'memory',
		}, entry.format);
		assert.deepEqual(fixture.preflights, [Math.max(
			fixture.plan.requiredTemporaryBytes,
			directCompressedStagingTemporaryBytes(fixture.plan)!,
		)], entry.format);
		if (entry.format === 'mp3') {
			assert.ok(directCompressedStagingTemporaryBytes(fixture.plan)! > fixture.plan.requiredTemporaryBytes);
		}
		assert.equal(fixture.stagedChannels[0]!.length, Number(fixture.plan.encoding.inputChannelCount), entry.format);
		assert.equal(fixture.ffmpegSettings[0]!.channelMapping, fixture.plan.encoding.channelMapping, entry.format);
		assertOrdered(fixture.events, 'picker', 'render:offline', entry.format);
		assertOrdered(fixture.events, 'render:offline', 'stage', entry.format);
		assertOrdered(fixture.events, 'stage', 'ffmpeg:stat', entry.format);
		assertOrdered(fixture.events, 'ffmpeg:stat', 'target:open', entry.format);
		assertOrdered(fixture.events, 'target:close', 'target:commit', entry.format);
		assert.equal(fixture.events.includes('render:realtime'), false, entry.format);
		assert.equal(fixture.events.includes('ffmpeg:encode'), false, entry.format);
		assert.equal(fixture.downloads.length, 0, entry.format);
		assert.equal(fixture.target.opens(), 1, entry.format);
		assert.equal(fixture.target.commits(), 1, entry.format);
		assert.equal(fixture.target.aborts(), 0, entry.format);
	}
});

test('offline compressed chooser cancellation and prepared-Blob mode preserve legacy behavior', async () => {
	const cancelled = serviceFixture('mp3', {}, { prepareMode: 'cancelled' });
	const cancellation = await createEditorExportService(cancelled.runtime).handleExportAction('export', { format: 'mp3' });
	assert.equal(cancellation.cancelled, true);
	assert.equal(cancelled.events.some((event) => event.startsWith('render:')), false);
	assert.deepEqual(cancelled.preflights, []);

	const blob = serviceFixture('ogg-vorbis', { quality: 7 }, { prepareMode: 'blob' });
	const legacy = await createEditorExportService(blob.runtime).handleExportAction('export', { format: 'ogg-vorbis' });
	assert.equal(legacy.mimeType, blob.plan.mimeType);
	assert.equal(blob.events.includes('render:offline'), true);
	assert.equal(blob.events.includes('ffmpeg:encode'), true);
	assert.equal(blob.events.includes('ffmpeg:stat'), false);
	assert.equal(blob.downloads.length, 1);
});

test('only ordinary offline renderer failure reuses the same unopened compressed target in realtime', async () => {
	const ordinary = serviceFixture('mp3', {}, { renderFailure: 'ordinary' });
	const result = await createEditorExportService(ordinary.runtime).handleExportAction('export', { format: 'mp3' });
	assert.equal(result.size, 5);
	assert.deepEqual(ordinary.events.filter((event) => event === 'picker'), ['picker']);
	assertOrdered(ordinary.events, 'render:offline', 'render:realtime', 'ordinary');
	assertOrdered(ordinary.events, 'render:realtime', 'ffmpeg:stat', 'ordinary');
	assert.equal(ordinary.events.includes('stage'), false);
	assert.equal(ordinary.target.opens(), 1);
	assert.equal(ordinary.target.aborts(), 0);

	for (const failure of ['abort', 'integrity', 'stale'] as const) {
		const fixture = serviceFixture('mp3', {}, { renderFailure: failure });
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export', { format: 'mp3' }), undefined);
		assert.equal(fixture.events.includes('render:realtime'), false, failure);
		assert.equal(fixture.events.includes('stage'), false, failure);
		assert.equal(fixture.target.opens(), 0, failure);
		assert.equal(fixture.target.aborts(), 1, failure);
	}
});

test('offline compressed post-render staging, FFmpeg, cancellation, and cleanup failures never retry', async () => {
	for (const failure of ['stage', 'ffmpeg', 'cancel'] as const) {
		const fixture = serviceFixture('wavpack', { sampleFormat: 'int24' }, { encodeFailure: failure });
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export', { format: 'wavpack' }), undefined);
		assert.equal(fixture.events.includes('render:offline'), true, failure);
		assert.equal(fixture.events.includes('render:realtime'), false, failure);
		assert.equal(fixture.target.commits(), 0, failure);
		assert.equal(fixture.target.aborts(), 1, failure);
		assert.equal(fixture.downloads.length, 0, failure);
	}

	const cleanup = serviceFixture('flac', { sampleFormat: 'int16' }, {
		abortFailure: new Error('destination cleanup failed'),
		encodeFailure: 'stage',
	});
	await createEditorExportService(cleanup.runtime).handleExportAction('export', { format: 'flac' });
	assert.ok(cleanup.errors[0] instanceof AggregateError);
	assert.match(String(cleanup.errors[0]), /cleanup/iu);

	const synchronousCleanup = serviceFixture('mp3', {}, {
		abortFailure: new Error('synchronous destination cleanup failed'),
		abortSynchronously: true,
		encodeFailure: 'ffmpeg',
	});
	await createEditorExportService(synchronousCleanup.runtime).handleExportAction('export', { format: 'mp3' });
	assert.ok(synchronousCleanup.errors[0] instanceof AggregateError);
	assert.equal(synchronousCleanup.target.aborts(), 1);
});

test('offline admission fingerprint and committed-size drift never publish stale output', async () => {
	const fingerprint = serviceFixture('mp3', {}, { fingerprintDrift: true });
	await createEditorExportService(fingerprint.runtime).handleExportAction('export', { format: 'mp3' });
	assert.equal(fingerprint.events.includes('render:offline'), true);
	assert.equal(fingerprint.events.includes('stage'), false);
	assert.equal(fingerprint.events.includes('ffmpeg:stat'), false);
	assert.equal(fingerprint.target.opens(), 0);
	assert.equal(fingerprint.target.aborts(), 1);

	const committed = serviceFixture('mp3', {}, { publishedSize: 6 });
	await createEditorExportService(committed.runtime).handleExportAction('export', { format: 'mp3' });
	assert.match(String(committed.errors[0]), /committed.*byte count/iu);
	assert.equal(committed.target.commits(), 1);
	assert.equal(committed.target.aborts(), 0);
	assert.equal(committed.state.exportOutput, null);
	assert.equal(committed.statuses.includes('done'), false);
});

test('late offline compressed commit ownership returns the file without stale success state', async () => {
	const commitStarted = deferred();
	const releaseCommit = deferred();
	const fixture = serviceFixture('aac-m4a', {}, {
		onCommit: async () => { commitStarted.resolve(); await releaseCommit.promise; },
	});
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export', { format: 'aac-m4a' });
	await commitStarted.promise;
	await service.handleExportAction('cancel');
	releaseCommit.resolve();
	const result = await saving;
	assert.equal(result.size, 5);
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('done'), false);
});

type PrepareMode = 'stream' | 'blob' | 'cancelled';
type RenderFailure = 'abort' | 'integrity' | 'ordinary' | 'stale';
type EncodeFailure = 'cancel' | 'ffmpeg' | 'stage';

function serviceFixture(
	format: DirectCompressedFormat,
	formatOptions: Readonly<Record<string, unknown>> = {},
	options: Readonly<{
		abortFailure?: Error;
		abortSynchronously?: boolean;
		encodeFailure?: EncodeFailure;
		fingerprintDrift?: boolean;
		onCommit?: () => PromiseLike<void> | void;
		prepareMode?: PrepareMode;
		publishedSize?: number;
		renderFailure?: RenderFailure;
	}> = {},
) {
	const plan = offlinePlan(format, formatOptions);
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const preflights: number[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const stagedChannels: Array<readonly Float32Array[]> = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const target = preparedTarget(plan.outputs[0].fileName, events, options);
	const project = projectFixture();
	let taskController: AbortController | null = null;
	let stale = false;
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => { if (signal?.aborted) throw signal.reason ?? abortError(); };
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
		createAiffStreamEncoder: () => { throw new Error('AIFF reached'); },
		createCacheAwareRenderEngine: () => ({
			loadProject: () => undefined,
			async renderMixRealtime(renderOptions: Readonly<Record<string, unknown>>) {
				events.push('render:realtime');
				const onChunk = renderOptions.onChunk as (
					channels: readonly Float32Array[], metadata: Readonly<Record<string, unknown>>,
				) => PromiseLike<unknown> | unknown;
				await onChunk(renderedChannels(2, plan.outputFrames), { sampleRate: plan.sampleRate });
			},
			dispose: async () => { events.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: async () => { throw new Error('stems reached'); },
		createStreamingWindowedSincResampler: (_input: number, _output: number, channelCount: number) => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => Array.from({ length: channelCount }, () => new Float32Array(0)),
		}),
		createTemporaryFileSink: async () => temporarySink(events),
		createWavStreamEncoder: (settings: Readonly<Record<string, unknown>>) => realtimeWavEncoder(settings),
		encodeAiff: () => { throw new Error('AIFF reached'); },
		encodeWav(channels: readonly Float32Array[]) {
			events.push('stage');
			stagedChannels.push(channels);
			if (options.encodeFailure === 'stage') throw new Error('staging failed');
			return Uint8Array.of(82, 73, 70, 70);
		},
		ffmpeg: {
			dispose: () => { events.push('ffmpeg:dispose'); },
			async encode() { events.push('ffmpeg:encode'); return { bytes: Uint8Array.of(9), mimeType: plan.mimeType }; },
			async encodeFile() { events.push('ffmpeg:encode-file'); return { bytes: Uint8Array.of(9), mimeType: plan.mimeType }; },
			async encodeFileToSink(_file: Blob, outputFormat: string, sink: FfmpegOutputSink<unknown>, settings: Readonly<Record<string, unknown>>) {
				assert.equal(outputFormat, format);
				ffmpegSettings.push(settings);
				if (options.encodeFailure === 'ffmpeg') throw new Error('FFmpeg failed');
				if (options.encodeFailure === 'cancel') taskController?.abort(new DOMException('cancelled', 'AbortError'));
				(settings.assertCurrent as () => void)();
				events.push('ffmpeg:stat');
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2, 3, 4, 5));
				const output = await sink.close();
				return { output, byteLength: 5, chunkCount: 1, extension: `.${plan.encoding.extension}`, mimeType: plan.mimeType };
			},
		},
		fileService: {
			prepareSave: () => {
				events.push('picker');
				if (options.prepareMode === 'cancelled') return { mode: 'cancelled', cancelled: true };
				if (options.prepareMode === 'blob') return { mode: 'blob' };
				return target;
			},
			createDownload: async (request: Readonly<Record<string, unknown>>) => {
				downloads.push(request);
				return { cancelled: false, url: 'blob:legacy', method: 'memory', cleanup: async () => undefined };
			},
		},
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => {
				taskController = new AbortController();
				return { signal: taskController.signal, assertCurrent: () => undefined, finish: () => undefined };
			},
			cancelTask: () => { taskController?.abort(abortError()); },
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			async renderSnapshot() {
				events.push('render:offline');
				if (options.renderFailure === 'abort') throw abortError();
				if (options.renderFailure === 'integrity') throw Object.assign(new Error('integrity'), { code: 'PROJECT_AUDIO_FALLBACK_INTEGRITY' });
				if (options.renderFailure === 'ordinary') throw new Error('renderer failed');
				if (options.renderFailure === 'stale') { stale = true; throw new Error('renderer failed'); }
				return { sampleRate: plan.sampleRate, channels: renderedChannels(Number(plan.encoding.inputChannelCount), plan.outputFrames) };
			},
		},
		playbackProjects: null,
		preflightStorage: async (bytes: number) => {
			preflights.push(bytes);
			if (options.fingerprintDrift) {
				const mutablePlan = plan as unknown as Record<string, unknown>;
				const render = plan.render as Readonly<Record<string, unknown>>;
				mutablePlan.render = { ...render, offlineRenderAdmission: {
					...(render.offlineRenderAdmission as Readonly<Record<string, unknown>>),
					maximumUsefulBinaryBytes: 1,
				} };
			}
		},
		prepareCommittedTimePitchCaches: async () => { events.push('prepare:caches'); },
		productName: 'Soundscaper', getProject: () => project,
		projectGeneration: { capture: () => 'token', assertCurrent: () => { if (stale) throw new Error('stale project'); } },
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: async () => { throw new Error('resample reached'); },
		setStatus: (status: string) => { statuses.push(status); },
		sourceBuffers: new Map(), state,
		stemProject: () => { throw new Error('stems reached'); }, store: {},
		taskProgress: { begin: () => ({ setPhase: () => true, finish: () => true }), setActivePhase: () => true },
		throwIfAborted, toggleExport: () => undefined, updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('fallback reached'); },
	};
	return { downloads, errors, events, ffmpegSettings, plan, preflights, runtime, stagedChannels, state, statuses, target };
}

function temporarySink(events: string[]) {
	return {
		persistent: true,
		write: async () => { events.push('realtime-stage:write'); },
		close: async () => { events.push('realtime-stage:close'); return new Blob([Uint8Array.of(1)], { type: 'audio/wav' }); },
		remove: async () => { events.push('realtime-stage:remove'); },
		abort: async () => { events.push('realtime-stage:abort'); },
	};
}

function realtimeWavEncoder(settings: Readonly<Record<string, unknown>>) {
	const pending: Promise<unknown>[] = [];
	const onChunk = settings.onChunk as (chunk: Uint8Array) => PromiseLike<unknown> | unknown;
	return {
		write() { pending.push(Promise.resolve(onChunk(Uint8Array.of(1)))); },
		finalize() {},
		async settled() { await Promise.all(pending); },
	};
}

function preparedTarget(
	fileName: string,
	events: string[],
	options: Readonly<{
		abortFailure?: Error;
		abortSynchronously?: boolean;
		onCommit?: () => PromiseLike<void> | void;
		publishedSize?: number;
	}>,
) {
	let bytes = 0;
	let opens = 0;
	let aborts = 0;
	let commits = 0;
	return {
		mode: 'stream' as const,
		async createWritable() {
			opens += 1;
			events.push('target:open');
			return new WritableStream<Uint8Array>({
				write(chunk) { bytes += chunk.byteLength; },
				close() { events.push('target:close'); },
			});
		},
		bytesWritten: () => bytes,
		async commit() {
			commits += 1;
			events.push('target:commit');
			await options.onCommit?.();
			return { method: 'memory', fileName, size: options.publishedSize ?? bytes };
		},
		abort() {
			aborts += 1;
			events.push('target:abort');
			if (options.abortFailure && options.abortSynchronously) throw options.abortFailure;
			return options.abortFailure ? Promise.reject(options.abortFailure) : Promise.resolve();
		},
		opens: () => opens, aborts: () => aborts, commits: () => commits,
	};
}

function offlinePlan(format: DirectCompressedFormat, options: Readonly<Record<string, unknown>>) {
	return createExportPlan(projectFixture(), {
		format, includeTail: false, livePcmBytes: 0, date: '2026-08-02', ...options,
	}) as ReturnType<typeof createExportPlan> & Readonly<{
		readonly encoding: Readonly<Record<string, unknown>> & {
			readonly channelMapping: unknown;
			readonly extension: string;
			readonly inputChannelCount: number;
		};
		readonly format: DirectCompressedFormat;
		readonly mimeType: string;
		readonly outputs: readonly [{ readonly fileName: string }];
	}>;
}

function renderedChannels(channelCount: number, frameCount: number): readonly Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => new Float32Array(frameCount).fill((channel + 1) / 10));
}

function projectFixture() {
	return {
		schemaVersion: 9, id: 'offline-compressed-service', title: 'Session', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 4 }, loop: { enabled: false, startFrame: 0, endFrame: 4 },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}

function assertOrdered(events: readonly string[], before: string, after: string, label: string): void {
	assert.ok(events.indexOf(before) < events.indexOf(after), `${label}: ${before} before ${after}`);
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((accept) => { resolve = accept; });
	return { promise, resolve };
}

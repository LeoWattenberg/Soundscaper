/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiffStreamEncoder, encodeAiff } from '../src/common/editor/aiff.js';
import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { DIRECT_PCM_RENDER_CHUNK_FRAMES } from '../src/common/editor/controller/direct-pcm-export.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import { PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE } from '../src/common/editor/project-fallback-integrity.ts';
import { createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';

type NativeFormat = 'aiff' | 'bwf' | 'bw64' | 'wav';

interface OfflinePlan extends Readonly<Record<string, unknown>> {
	readonly channelCount: number;
	readonly format: NativeFormat;
	readonly mimeType: string;
	readonly outputFileBytesPerRender: number;
	readonly outputFrames: number;
	readonly range: Readonly<{ readonly durationFrames: number; readonly endFrame: number; readonly startFrame: number }>;
	readonly render: Readonly<{ readonly strategy: 'offline' | 'realtime-stream' }>;
	readonly sampleRate: number;
}

interface FixtureOptions {
	readonly abortDuringRender?: Error;
	readonly abortError?: Error;
	readonly closeError?: Error;
	readonly cacheGate?: Readonly<{ promise: Promise<void> }>;
	readonly commitGate?: Readonly<{ promise: Promise<void> }>;
	readonly countDelta?: number;
	readonly destinationMode?: 'blob' | 'cancelled' | 'open-failure' | 'stream';
	readonly encoderCreateError?: Error;
	readonly frameCount?: number;
	readonly onCommit?: () => void;
	readonly onPrepareCaches?: () => void;
	readonly onWrite?: (index: number) => Promise<void> | void;
	readonly renderFailure?: unknown;
	readonly settings?: Readonly<Record<string, unknown>>;
	readonly staleAfterRenderFailure?: Error;
	readonly staleAfterCache?: Error;
	readonly writeErrorAt?: number;
}

test('actual offline WAV, AIFF, BWF, and BW64 plans stream without Blob assembly', async () => {
	for (const format of ['wav', 'aiff', 'bwf', 'bw64'] as const) {
		const converted = format === 'wav';
		const fixture = createFixture(format, {
			frameCount: 40_000,
			settings: {
				...(converted ? { sampleRate: 44_100, channelMapping: 'mono' } : {}),
				...((format === 'bwf' || format === 'bw64') ? { measureLoudness: true } : {}),
			},
		});
		assert.equal(fixture.plan.render.strategy, 'offline', format);

		const result = await fixture.service.handleExportAction('export', fixture.settings);

		assert.deepEqual(fixture.errors, [], `${format}: ${String(fixture.errors)}`);
		assert.equal(result.url, null, format);
		assert.equal(result.size, fixture.plan.outputFileBytesPerRender, format);
		assert.equal(fixture.destinationBytes(), fixture.plan.outputFileBytesPerRender, format);
		assert.equal(fixture.count('destination:close'), 1, format);
		assert.equal(fixture.count('destination:commit'), 1, format);
		assert.equal(fixture.count('destination:abort'), 0, format);
		assert.equal(fixture.count('mapping'), 1, format);
		assert.equal(fixture.count('one-shot'), 0, format);
		assert.equal(fixture.count('temporary'), 0, format);
		assert.equal(fixture.count('download'), 0, format);
		assert.equal(fixture.count('preflight'), 0, format);
		assert.ok(fixture.encoderBlocks.length > 0, format);
		assert.equal(
			fixture.encoderBlocks.every((frames) => frames <= DIRECT_PCM_RENDER_CHUNK_FRAMES),
			true,
			format,
		);
		assert.equal(
			fixture.encoderBlocks.reduce((total, frames) => total + frames, 0),
			fixture.plan.outputFrames,
			format,
		);
		assertOrder(fixture.events, ['destination:open', 'render:offline', 'mapping', 'encoder:create', 'destination:close', 'destination:commit']);
		if (converted) {
			assert.equal(fixture.plan.channelCount, 1);
			assert.equal(fixture.count('resample'), 1);
		}
	}
});

test('chooser cancellation and destination-open failure stop before rendering', async () => {
	const cancelled = createFixture('wav', { destinationMode: 'cancelled', frameCount: 8 });
	const cancelledResult = await cancelled.service.handleExportAction('export', cancelled.settings);
	assert.equal(cancelledResult.cancelled, true);
	assert.equal(cancelled.count('render:offline'), 0);
	assert.equal(cancelled.count('destination:open'), 0);

	const failed = createFixture('wav', { destinationMode: 'open-failure', frameCount: 8 });
	await failed.service.handleExportAction('export', failed.settings);
	assert.match((failed.errors[0] as Error).message, /destination open failed/iu);
	assert.equal(failed.count('render:offline'), 0);
	assert.equal(failed.count('destination:abort'), 1);
	assert.equal(failed.count('destination:commit'), 0);
});

test('only an ordinary renderer failure reuses the same empty target in realtime', async () => {
	const rendererFailure = new Error('offline renderer unavailable');
	const fallback = createFixture('wav', { frameCount: 8, renderFailure: rendererFailure });
	const result = await fallback.service.handleExportAction('export', fallback.settings);
	assert.equal(result.size, fallback.plan.outputFileBytesPerRender);
	assert.equal(fallback.count('picker'), 1);
	assert.equal(fallback.count('destination:open'), 1);
	assert.equal(fallback.count('render:realtime'), 1);
	assert.equal(fallback.count('destination:commit'), 1);
	assert.equal(fallback.statuses.includes('Realtime fallback'), true);
	assertOrder(fallback.events, ['destination:open', 'render:offline', 'render:realtime', 'destination:close', 'destination:commit']);

	for (const [failure, abortDuringRender] of [
		[Object.assign(new Error('cancelled render'), { name: 'AbortError' }), undefined],
		[Object.assign(new Error('fallback integrity changed'), { code: PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE }), undefined],
		[new Error('custom abort reason'), new Error('custom abort reason')],
	] as const) {
		const refused = createFixture('wav', {
			abortDuringRender,
			frameCount: 8,
			renderFailure: failure,
		});
		await refused.service.handleExportAction('export', refused.settings);
		assert.equal(refused.count('render:realtime'), 0);
		assert.equal(refused.count('destination:commit'), 0);
		assert.equal(refused.count('destination:abort'), 1);
	}

	const stale = new Error('project changed during failed render');
	const changed = createFixture('wav', {
		frameCount: 8, renderFailure: rendererFailure, staleAfterRenderFailure: stale,
	});
	await changed.service.handleExportAction('export', changed.settings);
	assert.strictEqual(changed.errors[0], stale);
	assert.equal(changed.count('render:realtime'), 0);
	assert.equal(changed.count('destination:commit'), 0);
});

test('offline broadcast loudness never falls back to an unmeasured realtime BEXT', async () => {
	for (const format of ['bwf', 'bw64'] as const) {
		const failure = new Error(`${format} renderer failed`);
		const fixture = createFixture(format, {
			frameCount: 8,
			renderFailure: failure,
			settings: { measureLoudness: true },
		});
		await fixture.service.handleExportAction('export', fixture.settings);
		assert.strictEqual(fixture.errors[0], failure, format);
		assert.equal(fixture.count('render:realtime'), 0, format);
		assert.equal(fixture.count('destination:commit'), 0, format);
		assert.equal(fixture.count('destination:abort'), 1, format);
	}
});

test('post-render encoder, write, close, and count failures never retry realtime', async () => {
	for (const [label, options] of [
		['header', { encoderCreateError: new Error('header construction failed') }],
		['write', { writeErrorAt: 2 }],
		['close', { closeError: new Error('destination close failed') }],
		['count', { countDelta: 1 }],
	] as const) {
		const fixture = createFixture('wav', { ...options, frameCount: 8 });
		await fixture.service.handleExportAction('export', fixture.settings);
		assert.equal(fixture.errors.length, 1, label);
		assert.equal(fixture.count('render:offline'), 1, label);
		assert.equal(fixture.count('render:realtime'), 0, label);
		assert.equal(fixture.count('destination:commit'), 0, label);
		assert.equal(fixture.count('destination:abort'), 1, label);
	}

	const primary = new Error('header failed');
	const cleanup = new Error('abort failed');
	const aggregate = createFixture('wav', {
		abortError: cleanup, encoderCreateError: primary, frameCount: 8,
	});
	await aggregate.service.handleExportAction('export', aggregate.settings);
	assert.ok(aggregate.errors[0] instanceof AggregateError);
	assert.deepEqual((aggregate.errors[0] as AggregateError).errors, [primary, cleanup]);
});

test('held offline writes cancel without close or publication', async () => {
	const writeStarted = deferred();
	const releaseWrite = deferred();
	const fixture = createFixture('wav', {
		frameCount: 8,
		onWrite: async (index) => {
			if (index !== 1) return;
			writeStarted.resolve();
			await releaseWrite.promise;
		},
	});
	const exporting = fixture.service.handleExportAction('export', fixture.settings);
	await writeStarted.promise;
	await fixture.service.handleExportAction('cancel');
	releaseWrite.resolve();
	await exporting;
	assert.equal(fixture.count('destination:abort'), 1);
	assert.equal(fixture.count('destination:close'), 0);
	assert.equal(fixture.count('destination:commit'), 0);
	assert.equal(fixture.state.exportOutput, null);
});

test('cancellation during realtime-fallback cache preparation never touches the reused target', async () => {
	const cacheStarted = deferred();
	const releaseCache = deferred();
	const fixture = createFixture('wav', {
		cacheGate: releaseCache,
		frameCount: 8,
		onPrepareCaches: () => { cacheStarted.resolve(); },
		renderFailure: new Error('offline renderer unavailable'),
	});
	const exporting = fixture.service.handleExportAction('export', fixture.settings);
	await cacheStarted.promise;
	await fixture.service.handleExportAction('cancel');
	releaseCache.resolve();
	await exporting;
	assert.equal(fixture.count('encoder:create'), 0);
	assert.equal(fixture.count('destination:write'), 0);
	assert.equal(fixture.count('destination:close'), 0);
	assert.equal(fixture.count('destination:commit'), 0);
	assert.equal(fixture.count('destination:abort'), 1);

	const stale = new Error('project changed during cache preparation');
	const staleCacheStarted = deferred();
	const releaseStaleCache = deferred();
	const changed = createFixture('wav', {
		cacheGate: releaseStaleCache,
		frameCount: 8,
		onPrepareCaches: () => { staleCacheStarted.resolve(); },
		renderFailure: new Error('offline renderer unavailable'),
		staleAfterCache: stale,
	});
	const staleExport = changed.service.handleExportAction('export', changed.settings);
	await staleCacheStarted.promise;
	releaseStaleCache.resolve();
	await staleExport;
	assert.strictEqual(changed.errors[0], stale);
	assert.equal(changed.count('encoder:create'), 0);
	assert.equal(changed.count('destination:write'), 0);
	assert.equal(changed.count('destination:close'), 0);
	assert.equal(changed.count('destination:commit'), 0);
	assert.equal(changed.count('destination:abort'), 1);
});

test('a late noncancellable commit returns ownership without reviving stale UI state', async () => {
	const commitStarted = deferred();
	const releaseCommit = deferred();
	const fixture = createFixture('wav', {
		commitGate: releaseCommit,
		frameCount: 8,
		onCommit: () => { commitStarted.resolve(); },
	});
	const exporting = fixture.service.handleExportAction('export', fixture.settings);
	await commitStarted.promise;
	await fixture.service.handleExportAction('cancel');
	releaseCommit.resolve();
	const result = await exporting;
	assert.equal(result.size, fixture.plan.outputFileBytesPerRender);
	assert.equal(fixture.count('destination:commit'), 1);
	assert.equal(fixture.count('destination:abort'), 0);
	assert.equal(fixture.state.exportOutput, null);
});

test('explicit Blob mode keeps the legacy native download route', async () => {
	const fixture = createFixture('wav', { destinationMode: 'blob', frameCount: 8 });
	const result = await fixture.service.handleExportAction('export', fixture.settings);
	assert.equal(result.method, 'object-url');
	assert.equal(fixture.count('preflight'), 1);
	assert.equal(fixture.count('one-shot'), 1);
	assert.equal(fixture.count('download'), 1);
	assert.equal(fixture.count('encoder:create'), 0);
});

function createFixture(format: NativeFormat, options: FixtureOptions = {}) {
	const frameCount = options.frameCount ?? 32;
	const project = projectFixture(frameCount, format === 'bw64');
	const settings = Object.freeze({
		format,
		bitDepth: 24,
		dither: 'none',
		includeTail: false,
		livePcmBytes: 0,
		date: '2026-08-02',
		productName: 'Soundscaper',
		...options.settings,
	});
	const rawPlan = createExportPlan(project, settings);
	if (rawPlan.outputFileBytesPerRender === null) throw new Error('Expected exact native PCM file geometry.');
	const plan = rawPlan as typeof rawPlan & OfflinePlan;
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const encoderBlocks: number[] = [];
	let bytes = 0;
	let writeIndex = 0;
	let controller: AbortController | null = null;
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const prepared = Object.freeze({
		mode: 'stream' as const,
		async createWritable() {
			events.push('destination:open');
			if (options.destinationMode === 'open-failure') throw new Error('destination open failed');
			return new WritableStream<Uint8Array>({
				async write(chunk) {
					writeIndex += 1;
					events.push('destination:write');
					await options.onWrite?.(writeIndex);
					if (writeIndex === options.writeErrorAt) throw new Error('destination write failed');
					bytes += chunk.byteLength;
				},
				close() {
					events.push('destination:close');
					if (options.closeError) throw options.closeError;
				},
			});
		},
		bytesWritten: () => bytes + (options.countDelta ?? 0),
		async commit() {
			events.push('destination:commit');
			options.onCommit?.();
			await options.commitGate?.promise;
			return Object.freeze({ fileName: plan.outputs[0]?.fileName, method: 'filesystem', size: bytes });
		},
		async abort() {
			events.push('destination:abort');
			if (options.abortError) throw options.abortError;
		},
	});
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping(channels: readonly Float32Array[], mapping: unknown) {
			events.push('mapping');
			return (applyMediaChannelMapping as unknown as (
				input: readonly Float32Array[], value: unknown,
			) => readonly Float32Array[])(channels, mapping);
		},
		audioBufferChannels: (buffer: Readonly<{ channels: readonly Float32Array[] }>) => buffer.channels,
		cloneProject: () => structuredClone(project),
		copy: {
			localSourcesMissing: 'Missing sources', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createAiffStreamEncoder: (encoderOptions: Readonly<Record<string, unknown>>) => (
			wrappedEncoder('aiff', encoderOptions)
		),
		createCacheAwareRenderEngine: () => ({
			loadProject() {},
			async renderMixRealtime(renderOptions: Readonly<{
				onChunk(channels: readonly Float32Array[], metadata: Readonly<{ sampleRate: number }>): unknown;
			}>) {
				events.push('render:realtime');
				await renderOptions.onChunk(renderedChannels(2, frameCount), { sampleRate: project.sampleRate });
			},
			async dispose() {},
		}),
		createExportPlan: () => plan,
		createStableId: () => 'offline-direct',
		createStreamingWindowedSincResampler: () => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => Array.from({ length: plan.channelCount }, () => new Float32Array()),
		}),
		createTemporaryFileSink: async () => {
			events.push('temporary');
			return {
				persistent: true, async write() {}, async abort() {}, async remove() {},
				async close(mimeType: string) { return new Blob([], { type: mimeType }); },
			};
		},
		createWavStreamEncoder: (encoderOptions: Readonly<Record<string, unknown>>) => (
			wrappedEncoder('wav', encoderOptions)
		),
		encodeAiff(channels: readonly Float32Array[], encoderOptions: Readonly<Record<string, unknown>>) {
			events.push('one-shot');
			return encodeAiff(channels, encoderOptions);
		},
		encodeWav(channels: readonly Float32Array[], encoderOptions: Readonly<Record<string, unknown>>) {
			events.push('one-shot');
			return encodeWav(channels, encoderOptions);
		},
		ffmpeg: { dispose() {}, async encode() { throw new Error('FFmpeg reached'); } },
		fileService: {
			async prepareSave() {
				events.push('picker');
				if (options.destinationMode === 'cancelled') return Object.freeze({ mode: 'cancelled', cancelled: true });
				if (options.destinationMode === 'blob') return Object.freeze({ mode: 'blob' });
				return prepared;
			},
			async createDownload(request: Readonly<{ blob: Blob; suggestedName: string }>) {
				events.push('download');
				return Object.freeze({
					cancelled: false, fileName: request.suggestedName, method: 'object-url',
					size: request.blob.size, url: 'blob:offline-direct', async cleanup() {},
				});
			},
		},
		getProject: () => project,
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask() {
				controller = new AbortController();
				return { signal: controller.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask: () => { controller?.abort(); },
		},
		normalizeExportSettings: () => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			async renderSnapshot() {
				events.push('render:offline');
				if (options.abortDuringRender) controller?.abort(options.abortDuringRender);
				if (options.renderFailure !== undefined) throw options.renderFailure;
				return Object.freeze({
					sampleRate: project.sampleRate,
					channels: renderedChannels(2, plan.range.durationFrames),
				});
			},
		},
		preflightStorage: async () => { events.push('preflight'); },
		async prepareCommittedTimePitchCaches() {
			events.push('prepare:caches');
			options.onPrepareCaches?.();
			await options.cacheGate?.promise;
		},
		productName: 'Soundscaper',
		projectGeneration: {
			capture: () => 'token',
			assertCurrent() {
				if (options.staleAfterRenderFailure && events.includes('render:offline')) {
					throw options.staleAfterRenderFailure;
				}
				if (options.staleAfterCache && events.includes('prepare:caches')) {
					throw options.staleAfterCache;
				}
			},
		},
		publishDocumentSnapshot() {},
		async resampleBuffer(_buffer: unknown, sampleRate: number, _context: unknown, _copy: unknown, outputFrames: number) {
			events.push('resample');
			return Object.freeze({ sampleRate, channels: renderedChannels(2, outputFrames) });
		},
		setStatus(message: string) { statuses.push(message); },
		sourceBuffers: new Map(),
		state,
		store: {},
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			getSnapshot: () => ({ kind: 'export' }), setActivePhase: () => true, updateActive: () => true,
		},
		throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw signal.reason; },
		toggleExport() {},
		updateExportProgress() {},
	};
	const service = createEditorExportService(runtime);
	return {
		count: (event: string) => events.filter((value) => value === event).length,
		destinationBytes: () => bytes,
		encoderBlocks,
		errors,
		events,
		plan,
		service,
		settings,
		state,
		statuses,
	};

	function wrappedEncoder(kind: 'aiff' | 'wav', encoderOptions: Readonly<Record<string, unknown>>) {
		events.push('encoder:create');
		if (options.encoderCreateError) throw options.encoderCreateError;
		const encoder = kind === 'aiff'
			? createAiffStreamEncoder(encoderOptions as Parameters<typeof createAiffStreamEncoder>[0])
			: createWavStreamEncoder(encoderOptions as Parameters<typeof createWavStreamEncoder>[0]);
		return {
			write(channels: readonly Float32Array[]) {
				encoderBlocks.push(channels[0]?.length ?? 0);
				return encoder.write(channels);
			},
			finalize: () => encoder.finalize(),
		};
	}
}

function renderedChannels(channelCount: number, frameCount: number): readonly Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => (
		Float32Array.from({ length: frameCount }, (_value, frame) => (frame + channel) / Math.max(1, frameCount))
	));
}

function projectFixture(frameCount: number, adm: boolean) {
	return {
		schemaVersion: 9, id: 'offline-direct-service', title: 'Offline direct service', revision: 1,
		createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2,
		metadata: adm ? {
			adm: {
				mode: 'authored',
				programme: { name: 'Programme', language: 'en' },
				content: { name: 'Content', language: 'en' },
				bed: {
					name: 'Stereo bed', layout: 'stereo',
					assignments: ['L', 'R'].map((bedChannel, sourceChannel) => ({
						stripKind: 'track', stripId: 'track', sourceChannel, bedChannel,
					})),
				},
			},
		} : {},
		selection: { startFrame: 0, endFrame: frameCount },
		loop: { enabled: false, startFrame: 0, endFrame: frameCount },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames: frameCount,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'],
			effectsActive: true, effects: [],
		}],
		mixer: { groups: [], sends: [], routes: {} },
		master: { effectsActive: true, effects: [] },
	};
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve: () => { resolve?.(); } };
}

function assertOrder(events: readonly string[], expected: readonly string[]): void {
	let index = -1;
	for (const event of expected) {
		const next = events.indexOf(event, index + 1);
		assert.notEqual(next, -1, `${event} missing from ${events.join(', ')}`);
		index = next;
	}
}

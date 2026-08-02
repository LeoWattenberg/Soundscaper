/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { unzipSync } from 'fflate';

import { captureDirectCompressedStemArchiveContract } from '../src/common/editor/controller/direct-compressed-stem-archive-plan.ts';
import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';
import { createExportPlan } from '../src/common/editor/export.js';

const FORMAT_CASES = Object.freeze([
	{ format: 'mp3', extension: 'mp3', options: { bitRate: 320 } },
	{ format: 'flac', extension: 'flac', options: { sampleFormat: 'int16', compressionLevel: 8 } },
	{ format: 'ogg-vorbis', extension: 'ogg', options: { quality: 7 } },
	{ format: 'opus', extension: 'opus', options: { bitRate: 192 } },
	{ format: 'wavpack', extension: 'wv', options: { sampleFormat: 'int24', compressionLevel: 5 } },
	{ format: 'mp2', extension: 'mp2', options: { bitRate: 384 } },
	{ format: 'aac-m4a', extension: 'm4a', options: { bitRate: 256 } },
]);

test('all canonical realtime compressed stem formats publish their final ZIP directly', async () => {
	for (const entry of FORMAT_CASES) {
		const fixture = serviceFixture({
			plan: actualPlan(entry.format, entry.options),
			requestedSettings: { mode: 'stems', format: entry.format, ...entry.options },
		});
		const contract = captureDirectCompressedStemArchiveContract(fixture.plan as never);
		assert.ok(contract, entry.format);
		const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
		assert.deepEqual(fixture.errors, [], entry.format);
		assert.equal(result.mimeType, 'application/zip', entry.format);
		assert.equal(result.size, fixture.target.bytes().byteLength, entry.format);
		assert.deepEqual(fixture.target.opened(), [[contract.maximumZip32.archiveByteLength, 'maximum']], entry.format);
		assert.deepEqual(fixture.preflights, [fixture.plan.outputBytesPerRender], entry.format);
		assert.deepEqual(fixture.ffmpegFormats, [entry.format, entry.format], entry.format);
		assert.equal(fixture.plan.outputs.every(({ fileName }) => fileName.endsWith(`.${entry.extension}`)), true);
		assert.ok(fixture.events.indexOf('picker') < fixture.events.indexOf('target:open'), entry.format);
		assert.ok(fixture.events.indexOf('target:open') < fixture.events.indexOf('render:0'), entry.format);
		assert.equal(fixture.events.includes('legacy-archive:create'), false, entry.format);
		assert.equal(fixture.downloads.length, 0, entry.format);
		assert.equal(fixture.target.commits(), 1, entry.format);
		assert.equal(fixture.target.aborts(), 0, entry.format);
	}
});

test('all centrally admitted offline compressed stem formats publish their final ZIP directly', async () => {
	for (const entry of FORMAT_CASES) {
		const plan = actualPlan(entry.format, {
			...entry.options,
			livePcmBytes: 0,
			channelMapping: entry.format === 'mp3' ? 'mono' : 'preserve',
		});
		const fixture = serviceFixture({
			plan,
			requestedSettings: { mode: 'stems', format: entry.format, ...entry.options },
		});
		const contract = captureDirectCompressedStemArchiveContract(plan as never);
		assert.ok(contract, entry.format);
		assert.equal(contract.renderStrategy, 'offline', entry.format);
		const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
		assert.deepEqual(fixture.errors, [], entry.format);
		assert.equal(result.mimeType, 'application/zip', entry.format);
		assert.deepEqual(fixture.preflights, [contract.stagingByteLength], entry.format);
		assert.equal(
			plan.requiredTemporaryBytes,
			plan.outputBytesPerRender * plan.outputs.length,
			entry.format,
		);
		assert.deepEqual(fixture.ffmpegFormats, [entry.format, entry.format], entry.format);
		assert.equal(fixture.mappingCalls(), 0, entry.format);
		assert.equal(fixture.stagedChannels.length, plan.outputs.length, entry.format);
		assert.equal(fixture.stagedChannels.every((channels) => (
			channels.length === Number(plan.encoding.inputChannelCount)
		)), true, entry.format);
		assert.equal(fixture.ffmpegSettings.every((settings) => (
			settings.channelMapping === plan.encoding.channelMapping
		)), true, entry.format);
		assert.ok(fixture.events.indexOf('target:open') < fixture.events.indexOf('render:offline:0'), entry.format);
		assert.equal(fixture.events.includes('legacy-archive:create'), false, entry.format);
		assert.equal(fixture.downloads.length, 0, entry.format);
		assert.equal(fixture.maximumRetained(), 1, entry.format);
		assert.equal(fixture.retained(), 0, entry.format);
		assert.equal(fixture.target.commits(), 1, entry.format);
		assert.equal(fixture.target.aborts(), 0, entry.format);
	}
});

test('service retains one encoded stem, streams an actual variable ZIP, then commits its exact size', async () => {
	const bodies = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7, 8)];
	const fixture = serviceFixture({ encodedBodies: bodies });
	const contract = captureDirectCompressedStemArchiveContract(fixture.plan as never);
	assert.ok(contract);
	const NativeBlob = globalThis.Blob;
	const blobTypes: string[] = [];
	class ObservedBlob extends NativeBlob {
		constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
			super(parts, options);
			blobTypes.push(this.type);
		}
	}
	globalThis.Blob = ObservedBlob;
	let result: Readonly<Record<string, unknown>>;
	try {
		result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
	} finally {
		globalThis.Blob = NativeBlob;
	}

	const layout = inspectZip32Layout(contract.outputs.map(({ fileName }, index) => ({
		fileName, byteLength: bodies[index]!.byteLength,
	})));
	assert.equal(fixture.plan.requiredTemporaryBytes, fixture.plan.outputBytesPerRender * fixture.plan.outputs.length);
	assert.deepEqual(fixture.preflights, [fixture.plan.outputBytesPerRender]);
	assert.deepEqual(blobTypes, ['audio/wav', 'audio/wav']);
	assert.equal(blobTypes.includes('application/zip'), false);
	assert.equal(fixture.maximumRetained(), 1);
	assert.equal(fixture.retained(), 0);
	assert.ok(fixture.events.indexOf('encoded:cleanup:0') < fixture.events.indexOf('render:1'));
	assert.ok(fixture.events.indexOf('target:close') < fixture.events.indexOf('target:commit'));
	assert.equal(fixture.target.commits(), 1);
	assert.equal(result.size, layout.archiveByteLength);
	assert.equal(fixture.target.bytes().byteLength, layout.archiveByteLength);
	const archive = unzipSync(fixture.target.bytes());
	assert.deepEqual(Object.keys(archive), contract.outputs.map(({ fileName }) => fileName));
	assert.deepEqual(archive[contract.outputs[0]!.fileName], bodies[0]);
	assert.deepEqual(archive[contract.outputs[1]!.fileName], bodies[1]);
});

test('prepared cancellation and Blob mode retain the legacy stem route', async () => {
	const cancelled = serviceFixture({ prepareMode: 'cancelled' });
	const cancellation = await cancelled.service.handleExportAction('export', cancelled.requestedSettings);
	assert.equal(cancellation.cancelled, true);
	assert.deepEqual(cancelled.preflights, []);
	assert.equal(cancelled.events.some((event) => event.startsWith('render:')), false);
	assert.equal(cancelled.downloads.length, 0);

	const blob = serviceFixture({ prepareMode: 'blob' });
	const result = await blob.service.handleExportAction('export', blob.requestedSettings);
	assert.equal(result.mimeType, 'application/zip');
	assert.deepEqual(blob.preflights, [blob.plan.requiredTemporaryBytes]);
	assert.equal(blob.events.includes('legacy-archive:create'), true);
	assert.equal(blob.events.includes('legacy-archive:finish'), true);
	assert.equal(blob.target.opened().length, 0);
	assert.equal(blob.downloads.length, 1);
	assert.ok(blob.downloads[0]?.blob instanceof Blob);

	const offlinePlan = actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 });
	const offlineBlob = serviceFixture({ plan: offlinePlan, prepareMode: 'blob' });
	const offlineResult = await offlineBlob.service.handleExportAction(
		'export', offlineBlob.requestedSettings,
	);
	assert.equal(offlineResult.mimeType, 'application/zip');
	assert.deepEqual(offlineBlob.preflights, [offlinePlan.requiredTemporaryBytes]);
	assert.equal(offlineBlob.events.includes('legacy-archive:create'), true);
	assert.equal(offlineBlob.target.opened().length, 0);
	assert.equal(offlineBlob.downloads.length, 1);
});

test('custom FFmpeg and 7z compressed stems remain on legacy delivery', async () => {
	const custom = actualPlan('custom-ffmpeg', {
		extension: 'foo', mimeType: 'audio/x-foo', customArguments: ['-c:a', 'copy'],
	});
	const sevenZip = structuredClone(actualPlan('mp3'));
	sevenZip.archive = {
		...sevenZip.archive, format: '7z', fileName: 'session-stems.7z',
		mimeType: 'application/x-7z-compressed',
	};
	for (const [label, plan] of [['custom', custom], ['7z', sevenZip]] as const) {
		const fixture = serviceFixture({ plan, requestedSettings: { mode: 'stems', format: plan.format } });
		const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
		assert.equal(captureDirectCompressedStemArchiveContract(plan as never), null, label);
		assert.equal(fixture.target.opened().length, 0, label);
		assert.equal(fixture.events.includes('picker'), false, label);
		assert.equal(fixture.events.includes('legacy-archive:create'), true, label);
		assert.equal(fixture.downloads.length, 1, label);
		assert.equal(result.mimeType, plan.archive.mimeType, label);
	}
});

test('an offline renderer failure retries only the current stem before its ZIP entry starts', async () => {
	const plan = actualPlan('mp3', { bitRate: 320, channelMapping: 'stereo' }, 0, 1, 300_000);
	const fixture = serviceFixture({ plan, offlineRenderFailureIndex: 1 });
	const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
	assert.equal(result.mimeType, 'application/zip');
	assert.deepEqual(fixture.errors, []);
	const archive = unzipSync(fixture.target.bytes());
	assert.deepEqual(Object.keys(archive), plan.outputs.map(({ fileName }) => fileName));
	assert.deepEqual(archive[plan.outputs[0]!.fileName], Uint8Array.of(1, 2, 3));
	assert.deepEqual(archive[plan.outputs[1]!.fileName], Uint8Array.of(4, 5, 6, 7, 8));
	assert.ok(fixture.events.indexOf('encoded:cleanup:0') < fixture.events.indexOf('render:offline:1'));
	assert.ok(fixture.events.indexOf('render:offline:1') < fixture.events.indexOf('render:0'));
	assert.equal(fixture.events.includes('legacy-archive:create'), false);
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
});

test('an offline codec failure retries before exposing the current stem to the ZIP writer', async () => {
	const plan = actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 });
	const fixture = serviceFixture({ plan, offlineEncodeFailureIndex: 1 });
	const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
	assert.equal(result.mimeType, 'application/zip');
	assert.deepEqual(fixture.errors, []);
	assert.ok(fixture.events.indexOf('encode:1') < fixture.events.indexOf('render:0'));
	assert.equal(fixture.events.includes('legacy-archive:create'), false);
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
});

test('stale ownership after an offline renderer failure prevents an internal realtime retry', async () => {
	const plan = actualPlan('mp3', { bitRate: 320, livePcmBytes: 0 });
	const fixture = serviceFixture({
		plan,
		offlineRenderFailureIndex: 0,
		staleOnOfflineRenderFailure: true,
	});
	assert.equal(await fixture.service.handleExportAction('export', fixture.requestedSettings), undefined);
	assert.equal(fixture.events.includes('render:0'), false);
	assert.equal(fixture.target.commits(), 0);
	assert.equal(fixture.target.aborts(), 1);
	assert.equal(fixture.errors.length, 1);
});

test('render, encode, staging cleanup, write, close, stale, and cancellation failures abort once', async () => {
	for (const failure of ['render', 'encode', 'staging-cleanup', 'write', 'close', 'stale', 'cancel'] as const) {
		const fixture = serviceFixture({ failure });
		const result = await fixture.service.handleExportAction('export', fixture.requestedSettings);
		assert.equal(result, undefined, failure);
		assert.equal(fixture.target.aborts(), 1, failure);
		assert.equal(fixture.target.commits(), 0, failure);
		assert.equal(fixture.downloads.length, 0, failure);
		assert.equal(fixture.events.includes('legacy-archive:create'), false, failure);
		assert.equal(fixture.retained(), 0, failure);
		if (failure === 'cancel') assert.deepEqual(fixture.errors, [], failure);
		else assert.equal(fixture.errors.length, 1, failure);
	}
});

test('late cancellation during commit returns the published ZIP without stale success UI', async () => {
	const commitStarted = deferred<void>();
	const releaseCommit = deferred<void>();
	const fixture = serviceFixture({
		onCommit: async () => { commitStarted.resolve(); await releaseCommit.promise; },
	});
	const saving = fixture.service.handleExportAction('export', fixture.requestedSettings);
	await commitStarted.promise;
	await fixture.service.handleExportAction('cancel');
	releaseCommit.resolve();
	const result = await saving;
	assert.equal(result.size, fixture.target.bytes().byteLength);
	assert.equal(result.mimeType, 'application/zip');
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
	assert.equal(fixture.downloads.length, 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('done'), false);
});

type Failure = 'cancel' | 'close' | 'encode' | 'render' | 'staging-cleanup' | 'stale' | 'write';
type PrepareMode = 'blob' | 'cancelled' | 'stream';

interface ServicePlan extends Record<string, unknown> {
	archive: Record<string, unknown> & { fileName: string; mimeType: string };
	encoding: Record<string, unknown>;
	format: string;
	mimeType: string;
	outputBytesPerRender: number;
	outputs: Array<{ fileName: string; trackId: string }>;
	render: Record<string, unknown> & { strategy: string };
	requiredTemporaryBytes: number;
}

interface FixtureOptions {
	readonly encodedBodies?: readonly Uint8Array[];
	readonly failure?: Failure;
	readonly offlineEncodeFailureIndex?: number;
	readonly offlineRenderFailureIndex?: number;
	readonly onCommit?: () => PromiseLike<void> | void;
	readonly plan?: ServicePlan;
	readonly prepareMode?: PrepareMode;
	readonly requestedSettings?: Readonly<Record<string, unknown>>;
	readonly staleOnOfflineRenderFailure?: boolean;
}

function serviceFixture(options: FixtureOptions = {}) {
	const plan = options.plan ?? actualPlan('mp3', { bitRate: 320 });
	const requestedSettings = options.requestedSettings ?? { mode: 'stems', format: plan.format, bitRate: 320 };
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const preflights: number[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const ffmpegFormats: string[] = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	const stagedChannels: Array<readonly Float32Array[]> = [];
	const bodies = options.encodedBodies ?? [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7, 8)];
	const project = projectFixture(Number(plan.encoding.inputChannelCount), Number(plan.outputFrames));
	const target = preparedTarget(plan.archive.fileName, events, options);
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	let taskController: AbortController | null = null;
	let sinkIndex = 0;
	let renderIndex = 0;
	let offlineRenderIndex = 0;
	let encodeIndex = 0;
	let retained = 0;
	let maximumRetained = 0;
	let mappingCalls = 0;
	let stale = false;
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => {
		if (signal?.aborted) throw signal.reason ?? abortError();
	};
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => {
			mappingCalls += 1;
			return channels;
		},
		audioBufferChannels: (audio: Readonly<{ channels: readonly Float32Array[] }>) => audio.channels,
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: {
			localSourcesMissing: 'missing', rendering: 'rendering', encoding: 'encoding', done: 'done',
			largeProjectRealtimeExport: 'realtime', realtimeExportFallback: 'fallback',
			realtimeStorageRequired: 'storage required', stemArchiveClosed: 'archive closed',
		},
		createAiffStreamEncoder: () => { throw new Error('unexpected AIFF encoder'); },
		createCacheAwareRenderEngine: () => {
			const index = renderIndex++;
			return {
				loadProject: () => undefined,
				async renderMixRealtime(renderOptions: Readonly<Record<string, unknown>>) {
					events.push(`render:${String(index)}`);
					assert.equal(retained, 0, 'the preceding encoded stem must be cleaned before the next render');
					if (options.failure === 'render' && index === 0) throw new Error('render failed');
					const onChunk = renderOptions.onChunk as (
						channels: readonly Float32Array[], metadata: Readonly<Record<string, unknown>>,
					) => PromiseLike<unknown> | unknown;
					await onChunk([Float32Array.of(index), Float32Array.of(index)], { sampleRate: 48_000 });
				},
				dispose: async () => { events.push(`render:dispose:${String(index)}`); },
			};
		},
		createExportPlan: () => plan,
		createStableId: () => `stage-${String(sinkIndex)}`,
		createStreamingStemArchive: async () => {
			events.push('legacy-archive:create');
			return {
				add: async (fileName: string) => { events.push(`legacy-archive:add:${fileName}`); },
				finish: async () => {
					events.push('legacy-archive:finish');
					return {
						blob: new Blob([Uint8Array.of(55)], { type: plan.archive.mimeType }),
						cleanup: async () => { events.push('legacy-archive:cleanup'); },
					};
				},
				abort: async () => { events.push('legacy-archive:abort'); },
			};
		},
		createStreamingWindowedSincResampler: (_input: number, _output: number, channelCount: number) => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => Array.from({ length: channelCount }, () => new Float32Array(0)),
		}),
		createTemporaryFileSink: async () => {
			const index = sinkIndex++;
			const chunks: ArrayBuffer[] = [];
			return {
				persistent: true,
				write: (chunk: Uint8Array) => { chunks.push(Uint8Array.from(chunk).buffer); },
				close: async (mimeType: string) => {
					events.push(`staging:close:${String(index)}`);
					return new Blob(chunks.length ? chunks : [Uint8Array.of(82, 73, 70, 70).buffer], { type: mimeType });
				},
				remove: async () => {
					events.push(`staging:remove:${String(index)}`);
					if (options.failure === 'staging-cleanup' && index === 0) throw new Error('staging cleanup failed');
				},
				abort: async () => { events.push(`staging:abort:${String(index)}`); },
			};
		},
		createWavStreamEncoder: (settings: Readonly<Record<string, unknown>>) => ({
			write: () => {
				const onChunk = settings.onChunk as (chunk: Uint8Array) => unknown;
				onChunk(Uint8Array.of(82, 73, 70, 70));
			},
			finalize: () => undefined,
			settled: async () => undefined,
		}),
		encodeAiff: () => { throw new Error('unexpected AIFF encoding'); },
		encodeWav: (channels: readonly Float32Array[]) => {
			stagedChannels.push(channels);
			return Uint8Array.of(82, 73, 70, 70);
		},
		ffmpeg: {
			dispose: () => { events.push('ffmpeg:dispose'); },
			encode: async (_bytes: Uint8Array, format: string, settings: Readonly<Record<string, unknown>>) => {
				const index = encodeIndex++;
				events.push(`encode:${String(index)}`);
				ffmpegFormats.push(format);
				ffmpegSettings.push(settings);
				if (options.offlineEncodeFailureIndex === index) throw new Error('offline codec failed');
				retained += 1;
				maximumRetained = Math.max(maximumRetained, retained);
				const bytes = bodies[index] ?? Uint8Array.of(index + 1);
				return {
					bytes, byteLength: bytes.byteLength, mimeType: plan.mimeType,
					cleanup: async () => {
						retained -= 1;
						events.push(`encoded:cleanup:${String(index)}`);
					},
				};
			},
			async encodeFile(file: Blob, format: string) {
				const index = encodeIndex++;
				events.push(`encode:${String(index)}`);
				ffmpegFormats.push(format);
				assert.equal(file.type, 'audio/wav');
				assert.ok(file.size > 0);
				if (options.failure === 'encode' && index === 0) throw new Error('encode failed');
				if (options.failure === 'cancel' && index === 0) taskController?.abort(abortError());
				if (options.failure === 'stale' && index === 0) stale = true;
				retained += 1;
				maximumRetained = Math.max(maximumRetained, retained);
				const bytes = bodies[index] ?? Uint8Array.of(index + 1);
				return {
					bytes, byteLength: bytes.byteLength, mimeType: plan.mimeType,
					cleanup: async () => {
						retained -= 1;
						events.push(`encoded:cleanup:${String(index)}`);
					},
				};
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
				return {
					signal: taskController.signal,
					assertCurrent: () => undefined,
					finish: () => undefined,
				};
			},
			cancelTask: () => { taskController?.abort(abortError()); },
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {
			async renderSnapshot() {
				const index = offlineRenderIndex++;
				events.push(`render:offline:${String(index)}`);
				if (options.offlineRenderFailureIndex === index) {
					if (options.staleOnOfflineRenderFailure) stale = true;
					throw new Error('offline renderer failed');
				}
				const channelCount = Number(plan.encoding.inputChannelCount);
				return {
					sampleRate: 48_000, length: 1, numberOfChannels: channelCount,
					channels: Array.from({ length: channelCount }, () => Float32Array.of(0)),
				};
			},
		},
		playbackProjects: null,
		preflightStorage: async (bytes: number) => { preflights.push(bytes); },
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper',
		getProject: () => project,
		projectGeneration: {
			capture: () => 'token',
			assertCurrent: () => { if (stale) throw new Error('stale project generation'); },
		},
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: async () => { throw new Error('unexpected resample'); },
		setStatus: (status: string) => { statuses.push(status); },
		sourceBuffers: new Map(),
		state,
		stemProject: (value: typeof project, trackId: string) => ({ ...structuredClone(value), activeStem: trackId }),
		store: {},
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			setActivePhase: () => true,
		},
		throwIfAborted,
		toggleExport: () => undefined,
		updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('unexpected fallback verification'); },
	};
	const service = createEditorExportService(runtime);
	return {
		downloads, errors, events, ffmpegFormats, ffmpegSettings, mappingCalls: () => mappingCalls,
		maximumRetained: () => maximumRetained, plan, preflights, requestedSettings,
		retained: () => retained, runtime, service, stagedChannels, state, statuses, target,
	};
}

function preparedTarget(fileName: string, events: string[], options: FixtureOptions) {
	const chunks: Uint8Array[] = [];
	const opened: Array<readonly [number, string]> = [];
	let byteLength = 0;
	let abortCount = 0;
	let commitCount = 0;
	return {
		mode: 'stream' as const,
		async createWritable(maximumByteLength: number, sizeMode: string) {
			opened.push([maximumByteLength, sizeMode]);
			events.push('target:open');
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.failure === 'write') throw new Error('target write failed');
					chunks.push(chunk.slice());
					byteLength += chunk.byteLength;
				},
				close() {
					events.push('target:close');
					if (options.failure === 'close') throw new Error('target close failed');
				},
			});
		},
		bytesWritten: () => byteLength,
		async commit() {
			commitCount += 1;
			events.push('target:commit');
			await options.onCommit?.();
			return { method: 'memory', fileName, size: byteLength };
		},
		abort: async () => { abortCount += 1; events.push('target:abort'); },
		opened: () => opened,
		commits: () => commitCount,
		aborts: () => abortCount,
		bytes: () => concatenate(chunks, byteLength),
	};
}

function actualPlan(
	format: string,
	formatOptions: Readonly<Record<string, unknown>> = {},
	livePcmBytes = 2 * 1024 ** 3,
	masterChannels = 2,
	durationFrames = 1,
): ServicePlan {
	return createExportPlan(projectFixture(masterChannels, durationFrames), {
		mode: 'stems', format, includeTail: false, livePcmBytes,
		date: '2026-08-02', ...formatOptions,
	}) as unknown as ServicePlan;
}

function projectFixture(masterChannels = 2, durationFrames = 1) {
	return {
		schemaVersion: 9, id: 'compressed-stem-service', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels, metadata: {},
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: durationFrames, channelCount: masterChannels, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames,
		}],
		tracks: [
			{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['clip'], effectsActive: true, effects: [] },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: [], effectsActive: true, effects: [] },
		],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}

function concatenate(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((done) => { resolve = done; });
	return { promise, resolve };
}

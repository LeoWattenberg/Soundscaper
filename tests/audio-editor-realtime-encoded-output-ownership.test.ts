/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import { createAiffStreamEncoder } from '../src/common/editor/aiff.js';
import { createWavStreamEncoder } from '../src/common/editor/wav.js';

interface FailureOptions {
	readonly abort?: Error;
	readonly encodedCleanup?: Error;
	readonly encode?: Error;
	readonly encoderSetup?: Error;
	readonly remove?: Error;
	readonly render?: Error;
	readonly rendererDispose?: Error;
	readonly rendererSetup?: Error;
	readonly sinkWrite?: Error;
}

interface FixtureOptions extends FailureOptions {
	readonly emptyEncodedOutput?: boolean;
	readonly format?: 'aiff' | 'mp3' | 'wav';
	readonly realStreamEncoder?: boolean;
	readonly renderChunkCount?: number;
	readonly sinkWriteFailureAt?: number;
}

test('a post-encode staging removal failure cleans the untransferred output', async () => {
	const fixture = ownershipFixture({ remove: new Error('staging removal failed') });

	assert.equal(await fixture.exportAudio(), undefined);
	assert.deepEqual(fixture.counts(), {
		aborts: 1,
		downloads: 0,
		encodedCleanups: 1,
		removes: 1,
		rendererDisposals: 1,
	});
	assert.equal(fixture.errors[0], fixture.failures.remove);
});

test('a renderer disposal failure cleans an encoded output that was never transferred', async () => {
	const fixture = ownershipFixture({ rendererDispose: new Error('renderer disposal failed') });

	assert.equal(await fixture.exportAudio(), undefined);
	assert.deepEqual(fixture.counts(), {
		aborts: 0,
		downloads: 0,
		encodedCleanups: 1,
		removes: 1,
		rendererDisposals: 1,
	});
	assert.equal(fixture.errors[0], fixture.failures.rendererDispose);
});

test('post-encode cleanup retains removal, abort, disposal, and output-cleanup failures', async () => {
	const fixture = ownershipFixture({
		remove: new Error('staging removal failed'),
		abort: new Error('staging abort failed'),
		rendererDispose: new Error('renderer disposal failed'),
		encodedCleanup: new Error('encoded cleanup failed'),
	});

	assert.equal(await fixture.exportAudio(), undefined);
	assert.deepEqual(fixture.counts(), {
		aborts: 1,
		downloads: 0,
		encodedCleanups: 1,
		removes: 1,
		rendererDisposals: 1,
	});
	assert.deepEqual(
		flattenErrors(fixture.errors[0]),
		[
			fixture.failures.remove,
			fixture.failures.abort,
			fixture.failures.rendererDispose,
			fixture.failures.encodedCleanup,
		],
	);
});

test('render and encode failures retain staging-abort and renderer-disposal failures', async () => {
	for (const primaryKind of ['render', 'encode'] as const) {
		const fixture = ownershipFixture({
			[primaryKind]: new Error(`${primaryKind} failed`),
			abort: new Error('staging abort failed'),
			rendererDispose: new Error('renderer disposal failed'),
		});

		assert.equal(await fixture.exportAudio(), undefined, primaryKind);
		assert.deepEqual(fixture.counts(), {
			aborts: 1,
			downloads: 0,
			encodedCleanups: 0,
			removes: 0,
			rendererDisposals: 1,
		}, primaryKind);
		assert.deepEqual(
			flattenErrors(fixture.errors[0]),
			[
				fixture.failures[primaryKind],
				fixture.failures.abort,
				fixture.failures.rendererDispose,
			],
			primaryKind,
		);
	}
});

test('encoder and renderer construction failures after sink creation abort staging', async () => {
	for (const setupKind of ['encoderSetup', 'rendererSetup'] as const) {
		const fixture = ownershipFixture({ [setupKind]: new Error(`${setupKind} failed`) });

		assert.equal(await fixture.exportAudio(), undefined, setupKind);
		assert.deepEqual(fixture.counts(), {
			aborts: 1,
			downloads: 0,
			encodedCleanups: 0,
			removes: 0,
			rendererDisposals: 0,
		}, setupKind);
		assert.equal(fixture.errors[0], fixture.failures[setupKind], setupKind);
	}
});

test('a native staged output is removed when renderer disposal prevents its transfer', async () => {
	const fixture = ownershipFixture({
		format: 'wav',
		rendererDispose: new Error('native renderer disposal failed'),
	});

	assert.equal(await fixture.exportAudio(), undefined);
	assert.deepEqual(fixture.counts(), {
		aborts: 0,
		downloads: 0,
		encodedCleanups: 0,
		removes: 1,
		rendererDisposals: 1,
	});
	assert.equal(fixture.errors[0], fixture.failures.rendererDispose);
});

test('a missing encoded result cannot pass as a successful realtime export', async () => {
	const fixture = ownershipFixture({ emptyEncodedOutput: true });

	assert.equal(await fixture.exportAudio(), undefined);
	assert.deepEqual(fixture.counts(), {
		aborts: 0,
		downloads: 0,
		encodedCleanups: 0,
		removes: 1,
		rendererDisposals: 1,
	});
	assert.match(String(fixture.errors[0]), /produced no encoded output/iu);
});

test('realtime staged PCM export surfaces a sink rejection before accepting another PCM block', async () => {
	for (const format of ['wav', 'aiff'] as const) {
		const sinkFailure = new Error(`staged ${format} sink failed`);
		const fixture = ownershipFixture({
			format,
			realStreamEncoder: true,
			renderChunkCount: 2,
			sinkWrite: sinkFailure,
		});

		assert.equal(await fixture.exportAudio(), undefined, format);
		assert.equal(fixture.renderedChunks(), 1, format);
		assert.equal(fixture.sinkWrites(), 2, `${format}: only the header and first PCM block reach the sink`);
		assert.equal(fixture.encoderSettlements(), 0, `${format}: encoder pending promises are not scanned`);
		assert.equal(fixture.errors[0], sinkFailure, format);
		assert.equal(fixture.counts().aborts, 1, format);

		const headerFailure = new Error(`staged ${format} header failed`);
		const headerFixture = ownershipFixture({
			format,
			realStreamEncoder: true,
			renderChunkCount: 2,
			sinkWrite: headerFailure,
			sinkWriteFailureAt: 1,
		});

		assert.equal(await headerFixture.exportAudio(), undefined, format);
		assert.equal(headerFixture.renderedChunks(), 0, `${format}: rendering waits for its header`);
		assert.equal(headerFixture.sinkWrites(), 1, `${format}: no PCM is emitted after its header fails`);
		assert.equal(headerFixture.encoderSettlements(), 0, format);
		assert.equal(headerFixture.errors[0], headerFailure, format);
		assert.equal(headerFixture.counts().aborts, 1, format);
	}
});

function ownershipFixture(options: FixtureOptions) {
	const failures = Object.freeze({
		abort: options.abort,
		encodedCleanup: options.encodedCleanup,
		encode: options.encode,
		encoderSetup: options.encoderSetup,
		remove: options.remove,
		render: options.render,
		rendererDispose: options.rendererDispose,
		rendererSetup: options.rendererSetup,
		sinkWrite: options.sinkWrite,
	});
	const format = options.format ?? 'mp3';
	const native = format === 'wav' || format === 'aiff';
	const nativeMimeType = format === 'aiff' ? 'audio/aiff' : 'audio/wav';
	const renderChunkCount = options.renderChunkCount ?? 1;
	const errors: unknown[] = [];
	let aborts = 0;
	let downloads = 0;
	let encodedCleanups = 0;
	let encoderSettlements = 0;
	let removes = 0;
	let renderedChunks = 0;
	let rendererDisposals = 0;
	let sinkWrites = 0;
	let sinkWriteTail = Promise.resolve();
	const project = {
		id: 'project', title: 'Session', sampleRate: 48_000, masterChannels: 2,
		tracks: [], clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }], sources: [],
	};
	const plan = {
		mode: 'mix', format, mimeType: native ? nativeMimeType : 'audio/mpeg', archive: null,
		sampleRate: 48_000, channelCount: 2,
		channelMapping: { mode: 'preserve', inputChannelCount: 2, outputChannelCount: 2 },
		encoding: {
			backend: native ? `native-${format}` : 'ffmpeg', extension: format,
			mimeType: native ? nativeMimeType : 'audio/mpeg', sampleRate: 48_000,
			inputChannelCount: 2, channelCount: 2,
			channelMapping: { mode: 'preserve', inputChannelCount: 2, outputChannelCount: 2 },
			bitRate: 192, sampleFormat: null, bitDepth: null, floatingPoint: false,
			dither: 'none', metadata: {},
		},
		dither: false, ditherMode: 'none', metadata: {},
		outputFrames: renderChunkCount, outputBytesPerRender: 8 * renderChunkCount, outputFileBytesPerRender: null,
		requiredTemporaryBytes: 8,
		range: { startFrame: 0, endFrame: renderChunkCount, durationFrames: renderChunkCount }, tailFrames: 0,
		render: { strategy: 'realtime-stream', fast: false, reason: 'output-memory' },
		outputs: [{
			kind: 'mix', fileName: `session.${format}`, trackId: null,
			includeMaster: true, respectMuteSolo: true,
		}],
	};
	const state = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const observeEncoderSettlements = <Encoder extends { settled(): Promise<void> }>(encoder: Encoder): Encoder => ({
		...encoder,
		async settled() {
			encoderSettlements += 1;
			await encoder.settled();
		},
	}) as Encoder;
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
		audioBufferChannels: () => { throw new Error('unexpected offline buffer'); },
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: {
			localSourcesMissing: 'missing', rendering: 'rendering', encoding: 'encoding', done: 'done',
			largeProjectRealtimeExport: 'realtime', realtimeExportFallback: 'fallback',
			realtimeStorageRequired: 'storage',
		},
		createAiffStreamEncoder: options.realStreamEncoder
			? (encoderOptions: Parameters<typeof createAiffStreamEncoder>[0]) => (
				observeEncoderSettlements(createAiffStreamEncoder(encoderOptions))
			)
			: () => { throw new Error('unexpected AIFF encoder'); },
		createCacheAwareRenderEngine: () => {
			if (failures.rendererSetup) throw failures.rendererSetup;
			return {
				loadProject: () => undefined,
				async renderMixRealtime(options: Readonly<Record<string, unknown>>) {
					if (failures.render) throw failures.render;
					for (let chunk = 0; chunk < renderChunkCount; chunk += 1) {
						renderedChunks += 1;
						await (options.onChunk as (
							channels: readonly Float32Array[],
							metadata: Readonly<Record<string, unknown>>,
						) => PromiseLike<unknown> | unknown)(
							[Float32Array.of(0.25), Float32Array.of(-0.25)],
							{ sampleRate: 48_000 },
						);
					}
				},
				async dispose() {
					rendererDisposals += 1;
					if (failures.rendererDispose) throw failures.rendererDispose;
				},
			};
		},
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: () => { throw new Error('unexpected stem archive'); },
		createStreamingWindowedSincResampler: () => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => [new Float32Array(0), new Float32Array(0)],
		}),
		createTemporaryFileSink: async () => ({
			persistent: true,
			write: () => {
				const writeNumber = ++sinkWrites;
				sinkWriteTail = sinkWriteTail.then(() => {
					if (failures.sinkWrite && writeNumber === (options.sinkWriteFailureAt ?? 2)) {
						throw failures.sinkWrite;
					}
				});
				return sinkWriteTail;
			},
			close: async () => new Blob([Uint8Array.of(1)], { type: 'audio/wav' }),
			async remove() {
				removes += 1;
				if (failures.remove) throw failures.remove;
			},
			async abort() {
				aborts += 1;
				if (failures.abort) throw failures.abort;
			},
		}),
		createWavStreamEncoder: options.realStreamEncoder
			? (encoderOptions: Parameters<typeof createWavStreamEncoder>[0]) => (
				observeEncoderSettlements(createWavStreamEncoder(encoderOptions))
			)
			: () => {
				if (failures.encoderSetup) throw failures.encoderSetup;
				return {
					write: () => undefined,
					finalize: () => undefined,
					settled: async () => undefined,
				};
			},
		encodeAiff: () => { throw new Error('unexpected AIFF encoding'); },
		encodeWav: () => { throw new Error('unexpected WAV encoding'); },
		ffmpeg: {
			dispose: () => undefined,
			async encodeFile() {
				if (failures.encode) throw failures.encode;
				if (options.emptyEncodedOutput) return null;
				return {
					bytes: Uint8Array.of(1, 2, 3),
					mimeType: 'audio/mpeg',
					async cleanup() {
						encodedCleanups += 1;
						if (failures.encodedCleanup) throw failures.encodedCleanup;
					},
				};
			},
		},
		fileService: {
			async createDownload() {
				downloads += 1;
				return { cancelled: false, url: 'blob:unexpected', method: 'memory' };
			},
		},
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => ({
				signal: new AbortController().signal,
				assertCurrent: () => undefined,
				finish: () => undefined,
			}),
			cancelTask: () => undefined,
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: {}, playbackProjects: null,
		preflightStorage: async () => undefined,
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper', getProject: () => project,
		projectGeneration: { capture: () => 'token', assertCurrent: () => undefined },
		publishDocumentSnapshot: () => undefined,
		resampleBuffer: () => { throw new Error('unexpected resampling'); },
		setStatus: () => undefined, sourceBuffers: new Map(), state,
		stemProject: () => { throw new Error('unexpected stems'); }, store: {},
		throwIfAborted: (signal?: AbortSignal | null) => {
			if (signal?.aborted) throw abortError();
		},
		toggleExport: () => undefined,
		updateExportProgress: () => undefined,
		verifyProjectFallbackIntegrity: async () => { throw new Error('unexpected fallback'); },
	};

	return {
		counts: () => ({ aborts, downloads, encodedCleanups, removes, rendererDisposals }),
		errors,
		exportAudio: () => createEditorExportService(runtime).handleExportAction(
			'export', { mode: 'mix', format, includeTail: false },
		),
		encoderSettlements: () => encoderSettlements,
		failures,
		renderedChunks: () => renderedChunks,
		sinkWrites: () => sinkWrites,
	};
}

function flattenErrors(value: unknown): unknown[] {
	return value instanceof AggregateError
		? value.errors.flatMap(flattenErrors)
		: [value];
}

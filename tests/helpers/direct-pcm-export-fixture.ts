/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExportServiceRuntime } from '../../src/common/editor/controller/export-service.ts';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { encodeWav } from '../../src/common/editor/wav.js';

export interface TestPlan extends Record<string, unknown> {
	mode: string;
	format: string;
	mimeType: string;
	outputs: Array<{ fileName: string; trackId: string }>;
	outputBytesPerRender: number;
	outputFileBytesPerRender: number | null;
	requiredTemporaryBytes: number;
	render: { strategy: string };
	range: { startFrame: number; endFrame: number; durationFrames: number };
	tailFrames: number;
	outputFrames: number;
	sampleRate: number;
	channelCount: number;
	channelMapping: Readonly<Record<string, unknown>>;
	encoding: Readonly<Record<string, unknown>>;
	ditherMode: string;
	archive: null;
}

export interface TestPreparedStream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Promise<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Promise<void>;
}

export interface ExportState {
	exportGeneration: number;
	exportAbort: null | { readonly signal: AbortSignal; abort(): void };
	mobile: boolean;
	outputUrl: string | null;
	outputCleanup: null | (() => Promise<void>);
	exportOutput: unknown;
	disposed: boolean;
}

export interface PreparedStreamOptions {
	readonly commitError?: Error;
	readonly onCommit?: () => Promise<void> | void;
	readonly onWrite?: (chunk: Uint8Array) => Promise<void> | void;
	readonly publishedFileName?: string;
	readonly publishedMimeType?: string;
	readonly publishedSize?: number;
	readonly reportedByteLength?: number;
	readonly writeErrorByte?: number;
	readonly writeErrorMessage?: string;
}

export interface DirectExportFixtureOptions {
	readonly encoderFinalByteLength?: number;
	readonly encoderFinalChunks?: readonly Uint8Array[];
	readonly encoderInitialChunks?: readonly Uint8Array[];
	readonly encoderWriteChunks?: (block: number) => readonly Uint8Array[];
	readonly inputChannelCount?: number;
	readonly publishedFileName?: string;
	readonly publishedMimeType?: string;
}

export interface PreparedStreamFixture {
	readonly admissions: Array<readonly [number, 'exact']>;
	readonly chunks: Uint8Array[];
	readonly prepared: TestPreparedStream;
	abortCalls(): number;
	closeCalls(): number;
	commitCalls(): number;
}

export interface DirectExportFixture {
	readonly calls: string[];
	readonly downloads: Array<Record<string, unknown>>;
	readonly encoderKinds: string[];
	readonly errors: unknown[];
	readonly preflights: number[];
	readonly prepareRequests: Array<Record<string, unknown>>;
	readonly renderRequests: Array<Readonly<Record<string, unknown>>>;
	readonly resamplerChannelCounts: number[];
	readonly runtime: ExportServiceRuntime;
	readonly state: ExportState;
	readonly statuses: string[];
	snapshots(): number;
	setPrepared(value: unknown): void;
}

export function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve: () => { resolve?.(); } };
}

export function directPlan(overrides: Readonly<Partial<TestPlan>> = {}): TestPlan {
	return {
		mode: 'mix',
		format: 'wav',
		mimeType: 'audio/wav',
		outputs: [{ fileName: 'mix.wav', trackId: 'track' }],
		outputBytesPerRender: 32,
		outputFileBytesPerRender: 4,
		requiredTemporaryBytes: 64,
		render: { strategy: 'realtime-stream' },
		range: { startFrame: 0, endFrame: 2, durationFrames: 2 },
		tailFrames: 0,
		outputFrames: 2,
		sampleRate: 48_000,
		channelCount: 2,
		channelMapping: { mode: 'stereo' },
		encoding: { bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' },
		ditherMode: 'none',
		archive: null,
		...overrides,
	};
}

export function createPreparedStream(options: PreparedStreamOptions = {}): PreparedStreamFixture {
	const chunks: Uint8Array[] = [];
	const admissions: Array<readonly [number, 'exact']> = [];
	let abortCalls = 0;
	let bytesWritten = 0;
	let closeCalls = 0;
	let commitCalls = 0;
	const prepared: TestPreparedStream = Object.freeze({
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>> {
			admissions.push([byteLength, sizeMode]);
			return new WritableStream<Uint8Array>({
				async write(chunk) {
					await options.onWrite?.(chunk);
					if (chunk[0] === options.writeErrorByte) {
						throw new Error(options.writeErrorMessage ?? 'direct WAV write failed');
					}
					chunks.push(chunk.slice());
					bytesWritten += chunk.byteLength;
				},
				close() { closeCalls += 1; },
			});
		},
		bytesWritten: () => options.reportedByteLength ?? bytesWritten,
		async commit() {
			commitCalls += 1;
			await options.onCommit?.();
			if (options.commitError) throw options.commitError;
			return Object.freeze({
				fileName: options.publishedFileName ?? 'direct.wav',
				method: 'file-system-access',
				mimeType: options.publishedMimeType ?? 'audio/wav',
				size: options.publishedSize ?? bytesWritten,
			});
		},
		async abort() { abortCalls += 1; },
	});
	return {
		admissions,
		chunks,
		prepared,
		abortCalls: () => abortCalls,
		closeCalls: () => closeCalls,
		commitCalls: () => commitCalls,
	};
}

export function createDirectPcmExportFixture(
	plan: TestPlan = directPlan(),
	options: DirectExportFixtureOptions = {},
): DirectExportFixture {
	const calls: string[] = [];
	const downloads: Array<Record<string, unknown>> = [];
	const encoderKinds: string[] = [];
	const errors: unknown[] = [];
	const preflights: number[] = [];
	const prepareRequests: Array<Record<string, unknown>> = [];
	const renderRequests: Array<Readonly<Record<string, unknown>>> = [];
	const resamplerChannelCounts: number[] = [];
	const statuses: string[] = [];
	const inputChannelCount = options.inputChannelCount ?? 2;
	const publishedFileName = options.publishedFileName ?? plan.outputs[0]?.fileName ?? 'mix.wav';
	const publishedMimeType = options.publishedMimeType ?? plan.mimeType;
	let snapshots = 0;
	let prepared: unknown = Object.freeze({ mode: 'blob', target: null, fileName: publishedFileName });
	let controller: AbortController | null = null;
	const state: ExportState = {
		exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null,
		outputCleanup: null, exportOutput: null, disposed: false,
	};
	const project = {
		id: 'project', title: 'Project', sampleRate: 48_000, masterChannels: inputChannelCount,
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		sources: [{ id: 'source' }],
	};
	const emitContainer = (encoderOptions: Readonly<Record<string, unknown>>) => {
		const onChunk = encoderOptions.onChunk as (chunk: Uint8Array) => Promise<void> | void;
		const pending: Array<Promise<void>> = [];
		let block = 0;
		const emit = (chunk: Uint8Array) => {
			const result = onChunk(chunk.slice());
			if (result && typeof result.then === 'function') pending.push(Promise.resolve(result));
		};
		for (const chunk of options.encoderInitialChunks ?? [Uint8Array.of(0)]) emit(chunk);
		return {
			write() {
				block += 1;
				calls.push(`encoder:write:${String(block)}`);
				for (const chunk of options.encoderWriteChunks?.(block) ?? [Uint8Array.of(block)]) emit(chunk);
			},
			finalize() {
				for (const chunk of options.encoderFinalChunks ?? [Uint8Array.of(3)]) emit(chunk);
				return { byteLength: options.encoderFinalByteLength ?? 4 };
			},
			async settled() { await Promise.all(pending); },
		};
	};
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
		// As many frames as the plan promises: a render that disagrees with its
		// plan is the defect conformance reopens the file to catch, so a fixture
		// that ships the disagreement cannot stand for an ordinary delivery.
		audioBufferChannels: () => Array.from(
			{ length: inputChannelCount },
			() => new Float32Array(plan.outputFrames),
		),
		cloneProject: () => structuredClone(project),
		copy: {
			localSourcesMissing: 'Missing sources', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createAiffStreamEncoder: (encoderOptions: Readonly<Record<string, unknown>>) => {
			encoderKinds.push('aiff');
			return emitContainer(encoderOptions);
		},
		createCacheAwareRenderEngine: () => ({
			loadProject() {},
			async renderMixRealtime(range: Readonly<{
				chunkFrames?: number;
				maximumPendingChunks?: number;
				onChunk: (channels: readonly Float32Array[], metadata: Readonly<{ sampleRate: number }>) => Promise<void> | void;
				signal: AbortSignal;
			}> & Readonly<Record<string, unknown>>) {
				renderRequests.push(range);
				calls.push('render:chunk:1');
				await range.onChunk(
					Array.from({ length: inputChannelCount }, (_, channel) => Float32Array.of(0.1 + channel / 100)),
					{ sampleRate: 48_000 },
				);
				throwIfAborted(range.signal);
				calls.push('render:chunk:2');
				await range.onChunk(
					Array.from({ length: inputChannelCount }, (_, channel) => Float32Array.of(0.3 + channel / 100)),
					{ sampleRate: 48_000 },
				);
				throwIfAborted(range.signal);
				calls.push('render:done');
				return { sampleRate: 48_000 };
			},
			async dispose() { calls.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'temporary',
		createStreamingWindowedSincResampler: (_inputRate: number, _outputRate: number, channelCount: number) => {
			resamplerChannelCounts.push(channelCount);
			return {
				push: (channels: readonly Float32Array[]) => channels,
				finish: () => Array.from({ length: channelCount }, () => new Float32Array(0)),
			};
		},
		createTemporaryFileSink: async () => {
			calls.push('temporary:create');
			const pieces: ArrayBuffer[] = [];
			return {
				persistent: true,
				async write(chunk: Uint8Array) { const copy = chunk.slice(); pieces.push(copy.buffer); },
				async close() { return new Blob(pieces, { type: publishedMimeType }); },
				async remove() { calls.push('temporary:remove'); },
				async abort() { calls.push('temporary:abort'); },
			};
		},
		createWavStreamEncoder: (encoderOptions: Readonly<Record<string, unknown>>) => {
			encoderKinds.push('wav');
			return emitContainer(encoderOptions);
		},
		// Real containers on the Blob fallback path, because that delivery is
		// conformed by reopening the file it wrote.
		encodeAiff: (channels: readonly Float32Array[], encodeOptions: Record<string, unknown>) => (
			encodeAiff(channels as Float32Array[], encodeOptions as never)
		),
		encodeWav: (channels: readonly Float32Array[], encodeOptions: Record<string, unknown>) => (
			encodeWav(channels as Float32Array[], encodeOptions as never)
		),
		ffmpeg: { dispose() {} },
		fileService: {
			async prepareSave(request: Record<string, unknown>) { prepareRequests.push(request); return prepared; },
			async createDownload(request: Record<string, unknown>) {
				downloads.push(request);
				const blob = request.blob as Blob;
				return Object.freeze({
					fileName: options.publishedFileName ?? request.suggestedName,
					method: 'object-url', size: blob.size, url: 'blob:fallback', async cleanup() {},
				});
			},
		},
		getProject: () => project,
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => {
				controller = new AbortController();
				return { signal: controller.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask: () => { controller?.abort(); },
		},
		normalizeExportSettings: (value: unknown) => value || {},
		normalizeProjectSampleRate: (value: number) => value,
		options: {},
		preflightStorage: async (byteLength: number) => { preflights.push(byteLength); },
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper',
		projectGeneration: { capture: () => 'token', assertCurrent() {} },
		publishDocumentSnapshot() { snapshots += 1; },
		setStatus(message: string) { statuses.push(message); },
		sourceBuffers: new Map(),
		state,
		throwIfAborted: (signal: AbortSignal) => {
			if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		},
		toggleExport() {},
	};
	return {
		calls, downloads, encoderKinds, errors, preflights, prepareRequests, renderRequests,
		resamplerChannelCounts, runtime, state, statuses,
		snapshots: () => snapshots,
		setPrepared: (value: unknown) => { prepared = value; },
	};
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}

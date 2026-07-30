/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DESKTOP_SAVE_BYTES } from '../desktop/constants.js';
import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_WAV_DESTINATION_WRITE_BYTES,
	DIRECT_WAV_MAXIMUM_PENDING_PCM_BYTES,
	DIRECT_WAV_MAXIMUM_FILE_BYTES,
	DIRECT_WAV_RENDER_CHUNK_FRAMES,
	createDirectWavEncoder,
	directWavMaximumPendingChunks,
	prepareDirectWavDestination,
} from '../src/common/editor/controller/direct-wav-export.ts';

interface TestPlan extends Record<string, unknown> {
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

interface TestPreparedStream {
	readonly mode: 'stream';
	createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>>;
	bytesWritten(): number;
	commit(): Promise<Readonly<Record<string, unknown>>>;
	abort(reason?: unknown): Promise<void>;
}

interface ExportState {
	exportGeneration: number;
	exportAbort: null | { readonly signal: AbortSignal; abort(): void };
	mobile: boolean;
	outputUrl: string | null;
	outputCleanup: null | (() => Promise<void>);
	exportOutput: unknown;
	disposed: boolean;
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
	let resolve: (() => void) | undefined;
	const promise = new Promise<void>((settle) => { resolve = settle; });
	return { promise, resolve: () => { resolve?.(); } };
}

function directPlan(): TestPlan {
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
	};
}

function createPreparedStream(options: Readonly<{
	commitError?: Error;
	onCommit?: () => Promise<void> | void;
	onWrite?: (chunk: Uint8Array) => Promise<void> | void;
	publishedSize?: number;
	reportedByteLength?: number;
	writeErrorByte?: number;
}> = {}) {
	const chunks: Uint8Array[] = [];
	const admissions: Array<readonly [number, 'exact']> = [];
	let abortCalls = 0;
	let bytesWritten = 0;
	let commitCalls = 0;
	const prepared: TestPreparedStream = Object.freeze({
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: 'exact'): Promise<WritableStream<Uint8Array>> {
			admissions.push([byteLength, sizeMode]);
			return new WritableStream<Uint8Array>({
				async write(chunk) {
					await options.onWrite?.(chunk);
					if (chunk[0] === options.writeErrorByte) throw new Error('direct WAV write failed');
					chunks.push(chunk.slice());
					bytesWritten += chunk.byteLength;
				},
			});
		},
		bytesWritten: () => options.reportedByteLength ?? bytesWritten,
		async commit() {
			commitCalls += 1;
			await options.onCommit?.();
			if (options.commitError) throw options.commitError;
			return Object.freeze({
				fileName: 'direct.wav', method: 'file-system-access',
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
		commitCalls: () => commitCalls,
	};
}

function createFixture(
	plan: TestPlan = directPlan(),
	options: Readonly<{ encoderByteLength?: number }> = {},
) {
	const calls: string[] = [];
	const downloads: Array<Record<string, unknown>> = [];
	const errors: unknown[] = [];
	const preflights: number[] = [];
	const prepareRequests: Array<Record<string, unknown>> = [];
	const renderRequests: Array<Readonly<Record<string, unknown>>> = [];
	const resamplerChannelCounts: number[] = [];
	const statuses: string[] = [];
	let snapshots = 0;
	let prepared: unknown = Object.freeze({ mode: 'blob', target: null, fileName: 'mix.wav' });
	let controller: AbortController | null = null;
	const state: ExportState = {
		exportGeneration: 0,
		exportAbort: null,
		mobile: false,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	const project = {
		id: 'project', title: 'Project', sampleRate: 48_000, masterChannels: 2,
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		sources: [{ id: 'source' }],
	};
	const emitWav = (encoderOptions: Readonly<Record<string, unknown>>) => {
		const onChunk = encoderOptions.onChunk as (chunk: Uint8Array) => Promise<void> | void;
		const pending: Array<Promise<void>> = [];
		let block = 0;
		const emit = (value: number) => {
			const result = onChunk(Uint8Array.of(value));
			if (result && typeof result.then === 'function') pending.push(Promise.resolve(result));
		};
		emit(0);
		return {
			write() {
				block += 1;
				calls.push(`encoder:write:${String(block)}`);
				emit(block);
			},
			finalize() { emit(3); return { byteLength: options.encoderByteLength ?? 4 }; },
			async settled() { await Promise.all(pending); },
		};
	};
	const runtime: ExportServiceRuntime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		applyMediaChannelMapping: (channels: readonly Float32Array[]) => channels,
		audioBufferChannels: () => [Float32Array.of(0), Float32Array.of(0)],
		cloneProject: () => structuredClone(project),
		copy: {
			localSourcesMissing: 'Missing sources', rendering: 'Rendering', encoding: 'Encoding', done: 'Done',
			largeProjectRealtimeExport: 'Realtime export', realtimeExportFallback: 'Fallback',
			realtimeStorageRequired: 'Storage required',
		},
		createAiffStreamEncoder: emitWav,
		createCacheAwareRenderEngine: () => ({
			loadProject() {},
			async renderMixRealtime(range: Readonly<{
				chunkFrames?: number;
				maximumPendingChunks?: number;
				onChunk: (channels: readonly Float32Array[], metadata: Readonly<{ sampleRate: number }>) => Promise<void> | void;
			}> & Readonly<Record<string, unknown>>) {
				renderRequests.push(range);
				calls.push('render:chunk:1');
				await range.onChunk([Float32Array.of(0.1), Float32Array.of(0.2)], { sampleRate: 48_000 });
				calls.push('render:chunk:2');
				await range.onChunk([Float32Array.of(0.3), Float32Array.of(0.4)], { sampleRate: 48_000 });
				calls.push('render:done');
				return { sampleRate: 48_000 };
			},
			async dispose() { calls.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'temporary',
		createStreamingWindowedSincResampler: (_inputRate: number, _outputRate: number, channelCount: number) => {
			resamplerChannelCounts.push(channelCount);
			return ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => [new Float32Array(0), new Float32Array(0)],
			});
		},
		createTemporaryFileSink: async () => {
			calls.push('temporary:create');
			const pieces: ArrayBuffer[] = [];
			return {
				persistent: true,
				async write(chunk: Uint8Array) {
					const copy = new Uint8Array(chunk.byteLength);
					copy.set(chunk);
					pieces.push(copy.buffer);
				},
				async close() { return new Blob(pieces, { type: 'audio/wav' }); },
				async remove() { calls.push('temporary:remove'); },
				async abort() { calls.push('temporary:abort'); },
			};
		},
		createWavStreamEncoder: emitWav,
		encodeAiff: () => Uint8Array.of(),
		encodeWav: () => Uint8Array.of(),
		ffmpeg: { dispose() {} },
		fileService: {
			async prepareSave(request: Record<string, unknown>) {
				prepareRequests.push(request);
				return prepared;
			},
			async createDownload(request: Record<string, unknown>) {
				downloads.push(request);
				const blob = request.blob as Blob;
				return Object.freeze({
					fileName: request.suggestedName,
					method: 'object-url',
					size: blob.size,
					url: 'blob:fallback',
					async cleanup() {},
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
		calls,
		downloads,
		errors,
		preflights,
		prepareRequests,
		renderRequests,
		resamplerChannelCounts,
		runtime,
		state,
		statuses,
		snapshots: () => snapshots,
		setPrepared: (value: unknown) => { prepared = value; },
	};
}

test('direct WAV encoder coalesces bounded PCM writes and awaits each destination flush', async () => {
	assert.equal(DIRECT_WAV_DESTINATION_WRITE_BYTES, 4 * 1024 * 1024);
	const half = DIRECT_WAV_DESTINATION_WRITE_BYTES / 2;
	const releaseWrite = deferred();
	const writeStarted = deferred();
	const writes: Uint8Array[] = [];
	let closed = false;
	let encoderOnChunk: ((chunk: Uint8Array) => void) | null = null;
	let block = 0;
	const encoder = await createDirectWavEncoder({
		async write(chunk) {
			writes.push(chunk.slice());
			if (chunk.byteLength === DIRECT_WAV_DESTINATION_WRITE_BYTES) {
				writeStarted.resolve();
				await releaseWrite.promise;
			}
		},
		async close() { closed = true; },
		async abort() {},
		bytesWritten: () => writes.reduce((total, chunk) => total + chunk.byteLength, 0),
		async commit() { return {}; },
	}, (options) => {
		encoderOnChunk = options.onChunk as (chunk: Uint8Array) => void;
		encoderOnChunk(Uint8Array.of(0));
		return {
			write() {
				block += 1;
				encoderOnChunk?.(new Uint8Array(half).fill(block));
			},
			finalize() { return { byteLength: 1 + 2 * half }; },
		};
	}, {});

	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1]);
	await encoder.write([Float32Array.of(0)]);
	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1]);
	let secondSettled = false;
	const second = encoder.write([Float32Array.of(0)]).then(() => { secondSettled = true; });
	await writeStarted.promise;
	assert.equal(secondSettled, false);
	assert.deepEqual(writes.map((chunk) => chunk.byteLength), [1, DIRECT_WAV_DESTINATION_WRITE_BYTES]);
	releaseWrite.resolve();
	await second;
	assert.equal(await encoder.finalize(), 1 + 2 * half);
	assert.equal(closed, true);
});

test('exact realtime WAV mixes await coalesced destination writes and publish no Blob', async () => {
	const fixture = createFixture();
	const writeStarted = deferred();
	const releaseWrite = deferred();
	const destination = createPreparedStream({
		onWrite: async (chunk) => {
			if (chunk[0] !== 1) return;
			writeStarted.resolve();
			await releaseWrite.promise;
		},
	});
	fixture.setPrepared(destination.prepared);
	const saving = createEditorExportService(fixture.runtime).handleExportAction('export', {
		saveTarget: { id: 'target' },
		useFileSystemAccess: true,
	});

	await writeStarted.promise;
	assert.deepEqual(fixture.calls, [
		'render:chunk:1', 'encoder:write:1',
		'render:chunk:2', 'encoder:write:2',
		'render:done',
	]);
	assert.equal(destination.commitCalls(), 0);
	releaseWrite.resolve();
	const result = await saving;

	assert.deepEqual(destination.admissions, [[4, 'exact']]);
	assert.deepEqual(destination.chunks.map((chunk) => [...chunk]), [[0], [1, 2, 3]]);
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.equal(fixture.downloads.length, 0);
	assert.deepEqual(fixture.preflights, []);
	assert.equal(fixture.calls.includes('temporary:create'), false);
	assert.equal(fixture.renderRequests[0].chunkFrames, DIRECT_WAV_RENDER_CHUNK_FRAMES);
	assert.equal(fixture.renderRequests[0].maximumPendingChunks, directWavMaximumPendingChunks(2));
	assert.deepEqual(fixture.prepareRequests.map((request) => ({
		purpose: request.purpose,
		suggestedName: request.suggestedName,
		mimeType: request.mimeType,
		target: request.target,
		types: request.types,
		useFileSystemAccess: request.useFileSystemAccess,
	})), [{
		purpose: 'audio-pcm-mix', suggestedName: 'mix.wav', mimeType: 'audio/wav',
		target: { id: 'target' },
		types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
		useFileSystemAccess: true,
	}]);
	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.wav',
		mimeType: 'audio/wav',
		size: 4,
		method: 'file-system-access',
	});
	assert.equal(fixture.state.outputUrl, null);
});

test('direct WAV resamples before a selection-only channel expansion', async () => {
	const mapping = {
		inputChannelCount: 2,
		outputChannelCount: 16,
		mode: 'custom',
		channels: Array.from({ length: 16 }, () => ({ inputs: [{ channel: 0, gain: 1 }] })),
	};
	const fixture = createFixture({ ...directPlan(), channelCount: 16, channelMapping: mapping });
	const destination = createPreparedStream();
	fixture.setPrepared(destination.prepared);
	await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.deepEqual(fixture.resamplerChannelCounts, [2]);
});
test('direct WAV pending PCM capacity is byte-bounded across render channel counts', () => {
	assert.equal(DIRECT_WAV_RENDER_CHUNK_FRAMES, 16_384);
	assert.equal(DIRECT_WAV_MAXIMUM_PENDING_PCM_BYTES, 32 * 1024 ** 2);
	assert.equal(directWavMaximumPendingChunks(1), 512);
	assert.equal(directWavMaximumPendingChunks(2), 256);
	assert.equal(directWavMaximumPendingChunks(16), 32);
	assert.equal(directWavMaximumPendingChunks(32), 16);
	for (let channels = 1; channels <= 32; channels += 1) {
		const retainedBytes = directWavMaximumPendingChunks(channels)
			* DIRECT_WAV_RENDER_CHUNK_FRAMES * channels * Float32Array.BYTES_PER_ELEMENT;
		assert.ok(retainedBytes <= DIRECT_WAV_MAXIMUM_PENDING_PCM_BYTES);
	}
	for (const invalid of [0, 1.5, 33, Number.NaN]) {
		assert.throws(() => directWavMaximumPendingChunks(invalid), /channel count/iu);
	}
});

test('direct WAV admission is exact and keeps other PCM plans on their existing path', async () => {
	assert.equal(DIRECT_WAV_MAXIMUM_FILE_BYTES, MAX_DESKTOP_SAVE_BYTES);
	for (const candidate of [
		{ ...directPlan(), format: 'bwf' },
		{ ...directPlan(), format: 'bw64' },
		{ ...directPlan(), format: 'aiff' },
		{ ...directPlan(), mimeType: 'audio/x-wav' },
		{ ...directPlan(), mode: 'stems' },
		{ ...directPlan(), outputs: [...directPlan().outputs, { fileName: 'other.wav', trackId: 'other' }] },
		{ ...directPlan(), outputs: [{ fileName: 'mix.wave', trackId: 'track' }] },
		{ ...directPlan(), outputFileBytesPerRender: null },
		{ ...directPlan(), outputFileBytesPerRender: 0 },
		{ ...directPlan(), outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES + 1 },
		{ ...directPlan(), render: { strategy: 'offline' } },
	] satisfies TestPlan[]) {
		let prepareCalls = 0;
		const preparation = await prepareDirectWavDestination({
			prepareSave() { prepareCalls += 1; return Object.freeze({ mode: 'blob' }); },
		}, candidate, {}, new AbortController().signal);
		assert.equal(prepareCalls, 0, `${candidate.format}:${candidate.mode}`);
		assert.equal(preparation.cancelled, null);
		assert.equal(preparation.destination, null);
	}
	let boundaryCalls = 0;
	await prepareDirectWavDestination({
		prepareSave() { boundaryCalls += 1; return Object.freeze({ mode: 'blob' }); },
	}, {
		...directPlan(),
		outputs: [{ fileName: 'MIX.WAV', trackId: 'track' }],
		outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES,
	}, {}, new AbortController().signal);
	assert.equal(boundaryCalls, 1);

	const fallback = createFixture();
	const result = await createEditorExportService(fallback.runtime).handleExportAction('export');
	assert.equal(fallback.prepareRequests.length, 1);
	assert.equal(fallback.calls.includes('temporary:create'), true);
	assert.equal(fallback.downloads.length, 1);
	assert.deepEqual(fallback.preflights, [64]);
	assert.equal(result.url, 'blob:fallback');
});

test('direct WAV cancellation avoids rendering and write or commit failures abort exactly once', async () => {
	const cancelled = createFixture();
	cancelled.setPrepared(Object.freeze({ mode: 'cancelled', cancelled: true, fileName: 'mix.wav' }));
	const cancelledResult = await createEditorExportService(cancelled.runtime).handleExportAction('export');
	assert.equal(cancelledResult.cancelled, true);
	assert.equal(cancelled.calls.includes('render:chunk:1'), false);
	assert.deepEqual(cancelled.preflights, []);

	for (const [label, destination] of [
		['write', createPreparedStream({ writeErrorByte: 1 })],
		['commit', createPreparedStream({ commitError: new Error('direct WAV commit failed') })],
	] as const) {
		const fixture = createFixture();
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.abortCalls(), 1, `${label} failure abort count`);
		assert.equal(destination.commitCalls(), label === 'commit' ? 1 : 0);
		assert.equal(fixture.downloads.length, 0);
		assert.match((fixture.errors[0] as Error).message, new RegExp(`direct WAV ${label} failed`, 'iu'));
	}
});

test('direct WAV publication requires plan, encoder, destination, and committed sizes to agree', async () => {
	for (const [label, fixture, destination, expectedCommitCalls, expectedAbortCalls] of [
		[
			'encoder', createFixture(directPlan(), { encoderByteLength: 3 }),
			createPreparedStream(), 0, 1,
		],
		[
			'destination', createFixture(),
			createPreparedStream({ reportedByteLength: 3 }), 0, 1,
		],
		[
			'committed', createFixture(),
			createPreparedStream({ publishedSize: 3 }), 1, 0,
		],
	] as const) {
		fixture.setPrepared(destination.prepared);
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
		assert.equal(destination.commitCalls(), expectedCommitCalls, `${label} commit count`);
		assert.equal(destination.abortCalls(), expectedAbortCalls, `${label} abort count`);
		assert.match((fixture.errors[0] as Error).message, new RegExp(label, 'iu'));
		assert.equal(fixture.state.exportOutput, null);
	}
});

test('cancellation during prior output cleanup prevents a stale direct commit', async () => {
	const cleanupStarted = deferred();
	const releaseCleanup = deferred();
	const destination = createPreparedStream();
	const fixture = createFixture();
	fixture.state.exportOutput = Object.freeze({ fileName: 'previous.wav' });
	fixture.state.outputCleanup = async () => {
		cleanupStarted.resolve();
		await releaseCleanup.promise;
	};
	fixture.setPrepared(destination.prepared);
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export');

	await cleanupStarted.promise;
	await service.handleExportAction('cancel');
	const snapshotsAfterCancellation = fixture.snapshots();
	releaseCleanup.resolve();
	assert.equal(await saving, undefined);

	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('Done'), false);
	assert.equal(fixture.snapshots(), snapshotsAfterCancellation);
});

test('cancellation during direct commit returns the saved file without stale success publication', async () => {
	const commitStarted = deferred();
	const releaseCommit = deferred();
	const destination = createPreparedStream({
		onCommit: async () => {
			commitStarted.resolve();
			await releaseCommit.promise;
		},
	});
	const fixture = createFixture();
	const previousOutput = Object.freeze({ url: 'blob:previous', fileName: 'previous.wav' });
	fixture.state.outputUrl = 'blob:previous';
	fixture.state.exportOutput = previousOutput;
	fixture.setPrepared(destination.prepared);
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export');

	await commitStarted.promise;
	await service.handleExportAction('cancel');
	const snapshotsAfterCancellation = fixture.snapshots();
	releaseCommit.resolve();
	const result = await saving;

	assert.deepEqual(result, {
		url: null,
		fileName: 'direct.wav',
		mimeType: 'audio/wav',
		size: 4,
		method: 'file-system-access',
	});
	assert.equal(destination.commitCalls(), 1);
	assert.equal(destination.abortCalls(), 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.state.outputUrl, null);
	assert.equal(fixture.statuses.includes('Done'), false);
	assert.equal(fixture.snapshots(), snapshotsAfterCancellation);
});

test('prior output cleanup failure aborts direct staging before commit', async () => {
	const destination = createPreparedStream();
	const fixture = createFixture();
	fixture.state.exportOutput = Object.freeze({ fileName: 'previous.wav' });
	fixture.state.outputCleanup = async () => { throw new Error('prior output cleanup failed'); };
	fixture.setPrepared(destination.prepared);

	assert.equal(await createEditorExportService(fixture.runtime).handleExportAction('export'), undefined);
	assert.equal(destination.commitCalls(), 0);
	assert.equal(destination.abortCalls(), 1);
	assert.match((fixture.errors[0] as Error).message, /prior output cleanup failed/iu);
	assert.deepEqual(fixture.state.exportOutput, { fileName: 'previous.wav' });
	assert.equal(fixture.statuses.includes('Done'), false);
});

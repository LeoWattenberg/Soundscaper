/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, type Hash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';
import {
	DIRECT_WAV_MAXIMUM_FILE_BYTES,
	prepareDirectWavDestination,
} from '../src/common/editor/controller/direct-wav-export.ts';
import { createExportPlan as createAudioExportPlan } from '../src/common/editor/export.js';
import { applyMediaChannelMapping } from '../src/common/editor/media-export.js';
import {
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS,
	createAsyncPlanarPcmSinkQueue,
} from '../src/common/editor/pcm-sink.js';
import { createAudioEditorProjectV2 } from '../src/common/editor/project-v2.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { createWavStreamEncoder } from '../src/common/editor/wav.js';

const CHANNEL_COUNT = 32;
const DESKTOP_OUTPUT_THRESHOLD_BYTES = 384 * 1024 ** 2;
const EXPECTED_OUTPUT_SHA256 = 'f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe';
const FLOAT64_DITHER_STATE_BYTES = CHANNEL_COUNT * Float64Array.BYTES_PER_ELEMENT;
const FRAME_COUNT = 3_153_920;
const HEADER_BYTES = 44;
const MAXIMUM_BUFFERED_BINARY_BYTES = 64 * 1024 ** 2;
const OUTPUT_PCM_BYTES = 385 * 1024 ** 2;
const OUTPUT_FILE_BYTES = HEADER_BYTES + OUTPUT_PCM_BYTES;
const PACKET_FRAMES = 4_096;
const PACKET_BYTES = PACKET_FRAMES * CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT;
const PACKET_COUNT = FRAME_COUNT / PACKET_FRAMES;
const PATH_OWNED_BINARY_UPPER_BOUND =
	AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS * PACKET_BYTES
	+ 2 * PACKET_BYTES
	+ 2 * HEADER_BYTES
	+ FLOAT64_DITHER_STATE_BYTES;
const REFERENCE_COMMAND = 'npm run test:reference:wav-385mib';
const REFERENCE_ENVIRONMENT = 'SOUNDSCAPER_RUN_REFERENCE_WAV_385MIB';
const REFERENCE_LIFECYCLE = 'test:reference:wav-385mib';
const RUN_REFERENCE_GATE = process.env.npm_lifecycle_event === REFERENCE_LIFECYCLE
	|| process.env[REFERENCE_ENVIRONMENT] === '1';
const SKIP_MESSAGE = `Reference-scale test skipped; run \`${REFERENCE_COMMAND}\` (or set ${REFERENCE_ENVIRONMENT}=1).`;

interface ReferencePlan extends Record<string, unknown> {
	readonly channelCount: number;
	readonly outputBytesPerRender: number;
	readonly outputFileBytesPerRender: number;
	readonly outputFrames: number;
	readonly render: Readonly<{ readonly reason: string; readonly strategy: string }>;
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

interface RenderRun {
	frames: number;
	maximumPendingPackets: number;
	packets: number;
}

interface CountingSession {
	readonly expectedBytes: number;
	readonly prefix: Uint8Array;
	abortCalls: number;
	bytesWritten: number;
	closeCalls: number;
	commitCalls: number;
	maximumConcurrentWrites: number;
	maximumEmissionBytes: number;
	outputSha256: string | null;
	writeCalls: number;
}

interface ReferenceFixture {
	readonly errors: unknown[];
	readonly plan: () => ReferencePlan;
	readonly preflightCalls: () => number;
	readonly renderRuns: RenderRun[];
	readonly service: ReturnType<typeof createEditorExportService>;
	readonly sessions: CountingSession[];
	readonly state: ExportState;
	readonly temporarySinkCalls: () => number;
	readonly downloadCalls: () => number;
	cancelNextExportAfterPcm(): void;
}

test('portable desktop-threshold gate streams an actual 385 MiB WAV through the production route without output retention', {
	skip: RUN_REFERENCE_GATE ? false : SKIP_MESSAGE,
}, async (context) => {
	assert.equal(FRAME_COUNT % PACKET_FRAMES, 0);
	assert.equal(PACKET_COUNT, 770);
	assert.equal(OUTPUT_PCM_BYTES, FRAME_COUNT * CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(OUTPUT_PCM_BYTES, DESKTOP_OUTPUT_THRESHOLD_BYTES + 1024 ** 2);
	assert.ok(PATH_OWNED_BINARY_UPPER_BOUND <= MAXIMUM_BUFFERED_BINARY_BYTES);

	const startedAt = performance.now();
	const fixture = createReferenceFixture();
	const result = await fixture.service.handleExportAction('export', exportSettings());
	const plan = fixture.plan();
	const saved = fixture.sessions[0];

	assert.equal(plan.render.strategy, 'realtime-stream');
	assert.equal(plan.render.reason, 'output-memory');
	assert.equal(plan.outputFrames, FRAME_COUNT);
	assert.equal(plan.outputBytesPerRender, OUTPUT_PCM_BYTES);
	assert.equal(plan.outputFileBytesPerRender, OUTPUT_FILE_BYTES);
	assert.equal(plan.channelCount, CHANNEL_COUNT);
	assert.deepEqual(result, {
		url: null,
		fileName: 'reference-direct.wav',
		mimeType: 'audio/wav',
		size: OUTPUT_FILE_BYTES,
		method: 'counting-sha256',
	});
	assert.equal(saved.expectedBytes, OUTPUT_FILE_BYTES);
	assert.equal(saved.bytesWritten, OUTPUT_FILE_BYTES);
	assert.equal(saved.outputSha256, EXPECTED_OUTPUT_SHA256);
	assert.equal(saved.writeCalls, 1 + PACKET_COUNT);
	assert.equal(saved.maximumEmissionBytes, PACKET_BYTES);
	assert.equal(saved.maximumConcurrentWrites, 1);
	assert.equal(saved.closeCalls, 1);
	assert.equal(saved.commitCalls, 1);
	assert.equal(saved.abortCalls, 0);
	assert.deepEqual(parseWavHeader(saved.prefix), {
		bitsPerSample: 32,
		blockAlign: 128,
		byteRate: 6_144_000,
		channelCount: CHANNEL_COUNT,
		dataBytes: OUTPUT_PCM_BYTES,
		dataId: 'data',
		formatBytes: 16,
		formatId: 'fmt ',
		formatTag: 3,
		riffBytes: OUTPUT_FILE_BYTES,
		riffId: 'RIFF',
		sampleRate: 48_000,
		waveId: 'WAVE',
	});
	assert.deepEqual(fixture.renderRuns[0], {
		frames: FRAME_COUNT,
		maximumPendingPackets: AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS,
		packets: PACKET_COUNT,
	});
	assert.equal(fixture.preflightCalls(), 0);
	assert.equal(fixture.temporarySinkCalls(), 0);
	assert.equal(fixture.downloadCalls(), 0);
	assert.deepEqual(fixture.errors, []);

	fixture.cancelNextExportAfterPcm();
	assert.equal(await fixture.service.handleExportAction('export', exportSettings()), undefined);
	const cancelled = fixture.sessions[1];
	assert.equal(cancelled.writeCalls, 2, 'the cancelled target receives its header and first PCM packet');
	assert.equal(cancelled.bytesWritten, HEADER_BYTES + PACKET_BYTES);
	assert.equal(cancelled.closeCalls, 0);
	assert.equal(cancelled.commitCalls, 0);
	assert.equal(cancelled.abortCalls, 1);
	assert.equal(cancelled.outputSha256, null);
	assert.equal(fixture.renderRuns[1].maximumPendingPackets, AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS);
	assert.deepEqual(fixture.errors, []);

	let oversizeTargetCalls = 0;
	const oversize = await prepareDirectWavDestination({
		prepareSave() {
			oversizeTargetCalls += 1;
			return Object.freeze({ mode: 'cancelled' });
		},
	}, {
		...plan,
		outputFileBytesPerRender: DIRECT_WAV_MAXIMUM_FILE_BYTES + 1,
	}, {}, new AbortController().signal);
	assert.equal(oversizeTargetCalls, 0);
	assert.deepEqual(oversize, { cancelled: null, destination: null });

	context.diagnostic(JSON.stringify({
		profile: 'direct-wav-385mib-counting-sha256-node-v1',
		fixtureId: 'm2-direct-wav-385mib-v1',
		generatorRevision: 1,
		durationMs: Math.round(performance.now() - startedAt),
		outputFrames: FRAME_COUNT,
		outputPcmBytes: OUTPUT_PCM_BYTES,
		outputFileBytes: OUTPUT_FILE_BYTES,
		outputSha256: saved.outputSha256,
		renderStrategy: plan.render.strategy,
		renderReason: plan.render.reason,
		renderPackets: fixture.renderRuns[0].packets,
		maximumPendingPackets: fixture.renderRuns[0].maximumPendingPackets,
		maximumEncoderEmissionBytes: saved.maximumEmissionBytes,
		retainedOutputPayloadBytes: 0,
		budgetMetrics: {
			'streaming.maxBufferedBinaryBytes': PATH_OWNED_BINARY_UPPER_BOUND,
			'streaming.oversizePreflightBytesRead': 0,
			'streaming.partialPublishedOutputs': 0,
		},
		unmeasuredBudgetMetricIds: [
			'streaming.rendererHeapDeltaBytes',
			'streaming.invalidPublishedRevisions',
		],
		rendererHeapQualified: false,
		processRssQualified: false,
		filesystemDurabilityQualified: false,
		packagedElectronQualified: false,
	}));
});

function createReferenceFixture(): ReferenceFixture {
	const project = createAudioEditorProjectV2({
		id: 'direct-wav-reference-project',
		title: 'Direct WAV reference',
		now: '2026-07-30T00:00:00.000Z',
		sampleRate: 48_000,
		masterChannels: CHANNEL_COUNT,
		sources: [{
			id: 'source', name: 'reference.wav', mimeType: 'audio/wav', storageKey: 'pcm/reference',
			frameCount: FRAME_COUNT, channelCount: CHANNEL_COUNT, sampleRate: 48_000,
		}],
		clips: [{
			id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: FRAME_COUNT,
		}],
		tracks: [{ id: 'track', type: 'audio', name: 'Reference', clipIds: ['clip'] }],
	});
	const errors: unknown[] = [];
	const renderRuns: RenderRun[] = [];
	const sessions: CountingSession[] = [];
	const state: ExportState = {
		exportGeneration: 0,
		exportAbort: null,
		mobile: false,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	let activeTask: AbortController | null = null;
	let cancelNextAfterPcm = false;
	let latestPlan: ReferencePlan | null = null;
	let preflightCalls = 0;
	let temporarySinkCalls = 0;
	let downloadCalls = 0;

	const runtime: ExportServiceRuntime = {
		abortError: () => new DOMException('The reference export was cancelled.', 'AbortError'),
		applyMediaChannelMapping,
		cloneProject: (value: unknown) => structuredClone(value),
		copy: {
			localSourcesMissing: 'Missing sources',
			rendering: 'Rendering',
			encoding: 'Encoding',
			done: 'Done',
			largeProjectRealtimeExport: 'Realtime export',
			realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Realtime storage required',
		},
		createAiffStreamEncoder: () => { throw new Error('AIFF is outside the direct WAV witness.'); },
		createCacheAwareRenderEngine: () => createReferenceRenderEngine(renderRuns),
		createExportPlan: (value: Record<string, unknown>, options: Record<string, unknown>) => {
			latestPlan = createAudioExportPlan(value, options) as unknown as ReferencePlan;
			return latestPlan;
		},
		createStableId: () => 'reference',
		createStreamingWindowedSincResampler,
		createTemporaryFileSink: () => {
			temporarySinkCalls += 1;
			throw new Error('The direct reference route must not create a temporary sink.');
		},
		createWavStreamEncoder,
		ffmpeg: { dispose() {} },
		fileService: {
			prepareSave: async () => {
				const cancelAfterPcm = cancelNextAfterPcm;
				cancelNextAfterPcm = false;
				const target = createCountingTarget({
					expectedBytes: OUTPUT_FILE_BYTES,
					cancelAfterPcm,
					onCancel: async () => { await service.handleExportAction('cancel'); },
				});
				sessions.push(target.session);
				return target.prepared;
			},
			createDownload: () => {
				downloadCalls += 1;
				throw new Error('The direct reference route must not create a Blob download.');
			},
		},
		getProject: () => project,
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: {
			startTask: () => {
				activeTask = new AbortController();
				return { signal: activeTask.signal, assertCurrent() {}, finish() {} };
			},
			cancelTask: () => { activeTask?.abort(new DOMException('Cancelled', 'AbortError')); },
		},
		normalizeExportSettings: (value: unknown) => value,
		normalizeProjectSampleRate: (value: number) => value,
		options: {},
		preflightStorage: () => {
			preflightCalls += 1;
			throw new Error('The direct reference route must not preflight temporary storage.');
		},
		prepareCommittedTimePitchCaches: async () => undefined,
		productName: 'Soundscaper',
		projectGeneration: { capture: () => 'reference', assertCurrent() {} },
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers: new Map(),
		state,
		throwIfAborted: (signal: AbortSignal) => {
			if (signal.aborted) throw signal.reason;
		},
		toggleExport() {},
	};
	const service = createEditorExportService(runtime);
	return {
		errors,
		plan: () => {
			assert.ok(latestPlan);
			return latestPlan;
		},
		preflightCalls: () => preflightCalls,
		renderRuns,
		service,
		sessions,
		state,
		temporarySinkCalls: () => temporarySinkCalls,
		downloadCalls: () => downloadCalls,
		cancelNextExportAfterPcm() { cancelNextAfterPcm = true; },
	};
}

function createReferenceRenderEngine(renderRuns: RenderRun[]) {
	return {
		loadProject() {},
		async renderMixRealtime(request: Readonly<{
			onChunk: (
				channels: readonly Float32Array[],
				metadata: Readonly<{ sampleRate: number }>,
			) => Promise<void> | void;
			signal: AbortSignal;
		}>) {
			const run: RenderRun = { frames: 0, maximumPendingPackets: 0, packets: 0 };
			renderRuns.push(run);
			const queue = createAsyncPlanarPcmSinkQueue(request.onChunk);
			const abort = () => { queue.abort(request.signal.reason); };
			request.signal.addEventListener('abort', abort, { once: true });
			try {
				for (let packet = 0; packet < PACKET_COUNT; packet += 1) {
					if (request.signal.aborted) throw request.signal.reason;
					const channels = Array.from(
						{ length: CHANNEL_COUNT },
						() => new Float32Array(PACKET_FRAMES),
					);
					assert.equal(queue.enqueue(channels, { sampleRate: 48_000 }), true);
					run.maximumPendingPackets = Math.max(run.maximumPendingPackets, queue.pendingChunks);
					if (queue.pendingChunks === AUDIO_EDITOR_PCM_SINK_MAX_PENDING_CHUNKS) {
						await queue.settled();
					}
				}
				const completed = await queue.finish();
				run.frames = completed.frameCount;
				run.packets = completed.chunkCount;
				return { sampleRate: 48_000, channelCount: CHANNEL_COUNT, frameCount: run.frames };
			} finally {
				request.signal.removeEventListener('abort', abort);
			}
		},
		async dispose() {},
	};
}

function createCountingTarget(options: Readonly<{
	expectedBytes: number;
	cancelAfterPcm: boolean;
	onCancel: () => Promise<void>;
}>) {
	const digest: Hash = createHash('sha256');
	let activeWrites = 0;
	let cancelRequested = false;
	const session: CountingSession = {
		expectedBytes: options.expectedBytes,
		prefix: new Uint8Array(HEADER_BYTES),
		abortCalls: 0,
		bytesWritten: 0,
		closeCalls: 0,
		commitCalls: 0,
		maximumConcurrentWrites: 0,
		maximumEmissionBytes: 0,
		outputSha256: null,
		writeCalls: 0,
	};
	const prepared = Object.freeze({
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: 'exact') {
			assert.equal(byteLength, options.expectedBytes);
			assert.equal(sizeMode, 'exact');
			return new WritableStream<Uint8Array>({
				async write(chunk) {
					activeWrites += 1;
					session.maximumConcurrentWrites = Math.max(session.maximumConcurrentWrites, activeWrites);
					try {
						assert.ok(chunk instanceof Uint8Array);
						assert.ok(chunk.byteLength > 0);
						assert.ok(session.bytesWritten + chunk.byteLength <= options.expectedBytes);
						if (session.bytesWritten < session.prefix.byteLength) {
							const count = Math.min(chunk.byteLength, session.prefix.byteLength - session.bytesWritten);
							session.prefix.set(chunk.subarray(0, count), session.bytesWritten);
						}
						digest.update(chunk);
						session.bytesWritten += chunk.byteLength;
						session.writeCalls += 1;
						session.maximumEmissionBytes = Math.max(session.maximumEmissionBytes, chunk.byteLength);
						if (options.cancelAfterPcm && session.writeCalls === 2 && !cancelRequested) {
							cancelRequested = true;
							await options.onCancel();
						}
						await Promise.resolve();
					} finally {
						activeWrites -= 1;
					}
				},
				close() { session.closeCalls += 1; },
			});
		},
		bytesWritten: () => session.bytesWritten,
		commit() {
			session.commitCalls += 1;
			assert.equal(session.closeCalls, 1);
			assert.equal(session.bytesWritten, options.expectedBytes);
			session.outputSha256 = digest.digest('hex');
			return Object.freeze({
				fileName: 'reference-direct.wav',
				method: 'counting-sha256',
				size: session.bytesWritten,
			});
		},
		abort() { session.abortCalls += 1; },
	});
	return { prepared, session };
}

function exportSettings() {
	return Object.freeze({
		format: 'wav',
		sampleFormat: 'float32',
		channelMapping: 'preserve',
		dither: 'none',
		includeTail: false,
		date: '2026-07-30',
		useFileSystemAccess: true,
		saveTarget: Object.freeze({ id: 'counting-reference-target' }),
	});
}

function parseWavHeader(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
	return {
		riffId: ascii(0),
		riffBytes: view.getUint32(4, true) + 8,
		waveId: ascii(8),
		formatId: ascii(12),
		formatBytes: view.getUint32(16, true),
		formatTag: view.getUint16(20, true),
		channelCount: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true),
		byteRate: view.getUint32(28, true),
		blockAlign: view.getUint16(32, true),
		bitsPerSample: view.getUint16(34, true),
		dataId: ascii(36),
		dataBytes: view.getUint32(40, true),
	};
}

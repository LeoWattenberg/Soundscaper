/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService, type ExportServiceRuntime } from '../src/common/editor/controller/export-service.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { applyMediaChannelMapping, buildMediaFfmpegEncoderArgs } from '../src/common/editor/media-export.js';

interface ServiceCase {
	readonly applyDither: boolean;
	readonly bitDepth: number;
	readonly extension: string;
	readonly float: boolean;
	readonly format: string;
	readonly mimeType: string;
	readonly name?: string;
	readonly options: Readonly<Record<string, unknown>>;
	readonly stagingDither: string;
}

interface ServicePlan {
	channelCount: number;
	encoding: Record<string, unknown> & {
		channelMapping: { mode: string };
		extension: string;
	};
	format: string;
	mimeType: string;
	outputBytesPerRender: number;
	outputFrames: number;
	outputs: Array<{ fileName: string }>;
	range: { durationFrames: number; endFrame: number };
	render: { outputBytes: number; totalBytes: number };
	requiredTemporaryBytes: number;
}

const SERVICE_CASES: readonly ServiceCase[] = Object.freeze([
	{ format: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg', options: { bitRate: 320 }, float: true, bitDepth: 24, stagingDither: 'none', applyDither: false },
	{ format: 'flac', extension: 'flac', mimeType: 'audio/flac', options: { sampleFormat: 'int16', compressionLevel: 8, dither: 'triangular-highpass' }, float: false, bitDepth: 16, stagingDither: 'triangular-highpass', applyDither: false },
	{ format: 'ogg-vorbis', extension: 'ogg', mimeType: 'audio/ogg; codecs=vorbis', options: { quality: -1 }, float: true, bitDepth: 24, stagingDither: 'none', applyDither: false },
	{ format: 'opus', extension: 'opus', mimeType: 'audio/ogg; codecs=opus', options: { bitRate: 320 }, float: true, bitDepth: 24, stagingDither: 'none', applyDither: false },
	{ format: 'wavpack', extension: 'wv', mimeType: 'audio/x-wavpack', options: { sampleFormat: 'int32', compressionLevel: 5, dither: 'triangular-highpass' }, float: true, bitDepth: 32, stagingDither: 'none', applyDither: true },
	{ name: 'wavpack float', format: 'wavpack', extension: 'wv', mimeType: 'audio/x-wavpack', options: { sampleFormat: 'float32', compressionLevel: 0, dither: 'triangular-highpass' }, float: true, bitDepth: 32, stagingDither: 'none', applyDither: false },
	{ format: 'mp2', extension: 'mp2', mimeType: 'audio/mpeg', options: { bitRate: 384 }, float: true, bitDepth: 24, stagingDither: 'none', applyDither: false },
	{ format: 'aac-m4a', extension: 'm4a', mimeType: 'audio/mp4', options: { bitRate: 320 }, float: true, bitDepth: 24, stagingDither: 'none', applyDither: false },
]);

test('export service routes every canonical realtime compressed format with exact staging and ordering', async () => {
	for (const entry of SERVICE_CASES) {
		const fixture = serviceFixture(entry, 'stream');
		const result = await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { mode: 'mix', format: entry.format, ...entry.options },
		);
		const label = entry.name || entry.format;
		assert.deepEqual(fixture.errors, [], label);
		assert.deepEqual(result, {
			url: null, fileName: fixture.plan.outputs[0].fileName,
			mimeType: entry.mimeType, size: 5, method: 'memory',
		}, label);
		assert.deepEqual(fixture.preflightBytes, [fixture.plan.requiredTemporaryBytes], label);
		assert.equal(fixture.encoderOptions.length, 1, label);
		assert.equal(fixture.encoderOptions[0]!.float, entry.float, label);
		assert.equal(fixture.encoderOptions[0]!.bitDepth, entry.bitDepth, label);
		assert.equal(fixture.encoderOptions[0]!.dither, entry.stagingDither, label);
		assert.equal(fixture.ffmpegSettings.length, 1, label);
		assert.equal(fixture.ffmpegSettings[0]!.applyDither, entry.applyDither, label);
		assert.equal(fixture.ffmpegSettings[0]!.bitDepth, entry.bitDepth, label);
		for (const [key, value] of Object.entries(fixture.plan.encoding)) {
			if (['bitDepth', 'channelCount', 'channelMapping', 'inputChannelCount'].includes(key)) continue;
			assert.deepEqual(fixture.ffmpegSettings[0]![key], value, `${label}:${key}`);
		}
		assert.equal(fixture.stagedPcm[0]!.length, fixture.plan.channelCount, `${label}:staged channels`);
		assert.equal(fixture.ffmpegSettings[0]!.inputChannelCount, fixture.plan.channelCount, `${label}:input channels`);
		assert.equal(fixture.ffmpegSettings[0]!.channelCount, fixture.plan.channelCount, `${label}:output channels`);
		assert.equal(fixture.ffmpegSettings[0]!.channelMapping, 'preserve', `${label}:mapping`);
		assert.equal(fixture.ffmpegArgs[0]!.some((argument) => argument.includes('pan=')), false, `${label}:FFmpeg pan`);
		assertOrdered(fixture.events, 'picker', 'render:realtime', label);
		assertOrdered(fixture.events, 'staging:close', 'ffmpeg:stat', label);
		assertOrdered(fixture.events, 'ffmpeg:stat', 'target:open', label);
		assertOrdered(fixture.events, 'ffmpeg:cleanup', 'staging:remove', label);
		assertOrdered(fixture.events, 'target:close', 'target:commit', label);
		assert.equal(fixture.events.includes('ffmpeg:encode-file'), false, label);
		assert.equal(fixture.downloads.length, 0, label);
		assert.equal(fixture.target.opens(), 1, label);
		assert.equal(fixture.target.commits(), 1, label);
		assert.equal(fixture.target.aborts(), 0, label);
	}
});

test('realtime compressed exports map staged mono and custom PCM exactly once', async () => {
	const input = [Float32Array.of(0.1), Float32Array.of(0.2)];
	const cases = [
		{
			format: 'mp3', mode: 'stream' as const,
			options: { bitRate: 320, channelMapping: 'mono' },
			expected: [[0.15]], expectedMode: 'mono',
		},
		{
			format: 'ogg-vorbis', mode: 'blob' as const,
			options: {
				quality: 7,
				channelMapping: { channels: [
					{ inputs: [{ channel: 1, gain: 0.25 }, { channel: 0, gain: 0.5 }] },
					{ inputs: [] },
					{ inputs: [{ channel: 0, gain: -1 }] },
				] },
			},
			expected: [[0.1], [0], [-0.1]], expectedMode: 'custom',
		},
	] as const;
	for (const entry of cases) {
		const plan = actualPlan(entry.format, entry.options);
		const fixture = serviceFixture(caseFor(entry.format), entry.mode, {
			chunkChannels: input,
			plan,
		});
		await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { mode: 'mix', format: entry.format, ...entry.options },
		);
		assert.deepEqual(fixture.errors, [], entry.format);
		assert.equal(fixture.stagedPcm.length, 1, entry.format);
		assertPcmClose(fixture.stagedPcm[0]!, entry.expected, entry.format);
		assert.equal(plan.encoding.channelMapping.mode, entry.expectedMode, entry.format);
		assert.equal(fixture.ffmpegSettings[0]!.inputChannelCount, plan.channelCount, entry.format);
		assert.equal(fixture.ffmpegSettings[0]!.channelCount, plan.channelCount, entry.format);
		assert.equal(fixture.ffmpegSettings[0]!.channelMapping, 'preserve', entry.format);
		assert.equal(fixture.ffmpegArgs[0]!.some((argument) => argument.includes('pan=')), false, entry.format);
	}
});

test('new compressed formats preserve chooser cancellation, Blob fallback, and custom legacy output', async () => {
	const opus = caseFor('opus');
	const cancelled = serviceFixture(opus, 'cancelled');
	const cancellation = await createEditorExportService(cancelled.runtime).handleExportAction(
		'export', { mode: 'mix', format: opus.format },
	);
	assert.equal(cancellation.cancelled, true);
	assert.deepEqual(cancelled.preflightBytes, []);
	assert.equal(cancelled.events.some((event) => event.startsWith('render:')), false);
	assert.equal(cancelled.events.some((event) => event.startsWith('ffmpeg:')), false);

	const aac = serviceFixture(caseFor('aac-m4a'), 'blob');
	const fallback = await createEditorExportService(aac.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'aac-m4a' },
	);
	assert.equal(fallback.mimeType, 'audio/mp4');
	assert.equal(aac.events.includes('ffmpeg:encode-file'), true);
	assert.equal(aac.events.includes('ffmpeg:stat'), false);
	assert.equal(aac.events.includes('staging:remove'), true);
	assert.equal(aac.downloads.length, 1);

	const customPlan = actualPlan('custom-ffmpeg', {
		extension: 'foo', mimeType: 'audio/x-foo', customArguments: ['-c:a', 'copy'],
	});
	const custom = serviceFixture(caseFor('opus'), 'stream', { plan: customPlan });
	const legacy = await createEditorExportService(custom.runtime).handleExportAction(
		'export', { mode: 'mix', format: 'custom-ffmpeg' },
	);
	assert.equal(legacy.mimeType, 'audio/x-foo');
	assert.equal(custom.events.includes('picker'), false);
	assert.equal(custom.events.includes('ffmpeg:stat'), false);
	assert.equal(custom.events.includes('ffmpeg:encode-file'), true);
	assert.equal(custom.downloads.length, 1);
});

test('new compressed routes refuse oversized nonpersistent staging before render and abort once', async () => {
	const entry = caseFor('wavpack');
	const plan = structuredClone(actualPlan(entry.format, entry.options));
	const byteLength = 97 * 1024 ** 2;
	plan.outputFrames = byteLength / (plan.channelCount * 4);
	plan.outputBytesPerRender = byteLength;
	plan.requiredTemporaryBytes = byteLength;
	plan.range.endFrame = plan.outputFrames;
	plan.range.durationFrames = plan.outputFrames;
	plan.render.totalBytes += byteLength - plan.render.outputBytes;
	plan.render.outputBytes = byteLength;
	const fixture = serviceFixture(entry, 'stream', { persistent: false, plan });
	assert.equal(await createEditorExportService(fixture.runtime).handleExportAction(
		'export', { mode: 'mix', format: entry.format },
	), undefined);
	assert.deepEqual(fixture.preflightBytes, [byteLength]);
	assert.equal(fixture.events.includes('staging:abort'), true);
	assert.equal(fixture.events.includes('render:realtime'), false);
	assert.equal(fixture.events.includes('ffmpeg:stat'), false);
	assert.equal(fixture.target.opens(), 0);
	assert.equal(fixture.target.aborts(), 1);
	assert.match(String(fixture.errors[0]), /storage required/iu);
});

test('new compressed result failure and plan drift clean staging and abort exactly once', async (context) => {
	let retainedFinalOutputBytes = 0;
	let partialPublishedOutputs = 0;
	for (const failure of ['result', 'drift'] as const) {
		const fixture = serviceFixture(caseFor('ogg-vorbis'), 'stream', { failure });
		assert.equal(await createEditorExportService(fixture.runtime).handleExportAction(
			'export', { mode: 'mix', format: 'ogg-vorbis' },
		), undefined);
		assert.equal(fixture.errors.length, 1, failure);
		assert.equal(fixture.events.includes('staging:remove'), true, failure);
		assert.equal(fixture.target.aborts(), 1, failure);
		assert.equal(fixture.target.commits(), 0, failure);
		assert.equal(fixture.downloads.length, 0, failure);
		retainedFinalOutputBytes = Math.max(
			retainedFinalOutputBytes, fixture.state.exportOutput === null ? 0 : Number.MAX_SAFE_INTEGER,
		);
		partialPublishedOutputs += fixture.target.commits();
	}
	if (process.env.SOUNDSCAPER_M2_DIRECT_STRUCTURAL_WORKLOAD === 'm2-direct-compressed-output-v2') {
		context.diagnostic(JSON.stringify({
			profile: 'focused-direct-structural-node-v2',
			workloadId: 'm2-direct-compressed-output-v2',
			fixtureId: 'm2-direct-compressed-output-v2',
			budgetMetrics: {
				'directCompressed.retainedFinalOutputBytes': retainedFinalOutputBytes,
				'directCompressed.partialPublishedOutputs': partialPublishedOutputs,
			},
		}));
	}
});

test('late cancellation during new compressed commit returns the file without stale success UI', async () => {
	const commitStarted = deferred<void>();
	const releaseCommit = deferred<void>();
	const fixture = serviceFixture(caseFor('aac-m4a'), 'stream', {
		onCommit: async () => { commitStarted.resolve(); await releaseCommit.promise; },
	});
	const service = createEditorExportService(fixture.runtime);
	const saving = service.handleExportAction('export', { mode: 'mix', format: 'aac-m4a' });
	await commitStarted.promise;
	await service.handleExportAction('cancel');
	releaseCommit.resolve();
	const result = await saving;
	assert.equal(result.size, 5);
	assert.equal(result.mimeType, 'audio/mp4');
	assert.equal(fixture.target.commits(), 1);
	assert.equal(fixture.target.aborts(), 0);
	assert.equal(fixture.state.exportOutput, null);
	assert.equal(fixture.statuses.includes('done'), false);
});

type PrepareMode = 'stream' | 'blob' | 'cancelled';

function serviceFixture(entry: ServiceCase, mode: PrepareMode, options: Readonly<{
	chunkChannels?: readonly Float32Array[];
	failure?: 'result' | 'drift';
	onCommit?: () => PromiseLike<void> | void;
	persistent?: boolean;
	plan?: ServicePlan;
}> = {}) {
	const plan = options.plan || actualPlan(entry.format, entry.options);
	const events: string[] = [];
	const errors: unknown[] = [];
	const statuses: string[] = [];
	const preflightBytes: number[] = [];
	const downloads: Array<Readonly<Record<string, unknown>>> = [];
	const encoderOptions: Array<Readonly<Record<string, unknown>>> = [];
	const ffmpegArgs: string[][] = [];
	const ffmpegSettings: Array<Readonly<Record<string, unknown>>> = [];
	const stagedPcm: Array<readonly Float32Array[]> = [];
	const state = { exportGeneration: 0, exportAbort: null, mobile: false, outputUrl: null, outputCleanup: null, exportOutput: null, disposed: false };
	const target = preparedTarget(() => plan.outputs[0].fileName, events, options.onCommit);
	const project = realtimeProject();
	let taskController: AbortController | null = null;
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => { if (signal?.aborted) throw abortError(); };
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping,
		audioBufferChannels: (audio: Readonly<{ channels: readonly Float32Array[] }>) => audio.channels,
		cloneProject: (value: typeof project) => structuredClone(value),
		copy: { localSourcesMissing: 'missing', rendering: 'rendering', encoding: 'encoding', done: 'done', largeProjectRealtimeExport: 'realtime', realtimeExportFallback: 'fallback', realtimeStorageRequired: 'storage required' },
		createAiffStreamEncoder: () => { throw new Error('unexpected AIFF encoder'); },
		createCacheAwareRenderEngine: () => ({
			loadProject: () => undefined,
			async renderMixRealtime(renderOptions: Readonly<Record<string, unknown>>) {
				events.push('render:realtime');
				const onChunk = renderOptions.onChunk as (channels: readonly Float32Array[], metadata: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
				await onChunk(options.chunkChannels || [Float32Array.of(0.1), Float32Array.of(0.2)], { sampleRate: 48_000 });
			},
			dispose: async () => { events.push('render:dispose'); },
		}),
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingStemArchive: async () => { throw new Error('unexpected stem archive'); },
		createStreamingWindowedSincResampler: (_inputRate: number, _outputRate: number, channelCount: number) => ({
			push: (channels: readonly Float32Array[]) => channels,
			finish: () => Array.from({ length: channelCount }, () => new Float32Array(0)),
		}),
		createTemporaryFileSink: async () => ({
			persistent: options.persistent !== false,
			write: async () => { events.push('staging:write'); },
			close: async () => { events.push('staging:close'); return new Blob([Uint8Array.of(0)], { type: 'audio/wav' }); },
			remove: async () => { events.push('staging:remove'); },
			abort: async () => { events.push('staging:abort'); },
		}),
		createWavStreamEncoder: (settings: Readonly<Record<string, unknown>>) => {
			encoderOptions.push(settings);
			const pending: Promise<unknown>[] = [];
			const onChunk = settings.onChunk as (chunk: Uint8Array) => PromiseLike<unknown> | unknown;
			return {
				write: (channels: readonly Float32Array[]) => {
					stagedPcm.push(channels.map((channel) => channel.slice()));
					pending.push(Promise.resolve(onChunk(Uint8Array.of(0))));
				},
				finalize: () => undefined,
				settled: async () => { await Promise.all(pending); },
			};
		},
		encodeAiff: () => { throw new Error('unexpected offline AIFF'); },
		encodeWav: () => { throw new Error('unexpected offline WAV'); },
		ffmpeg: {
			dispose: () => { events.push('ffmpeg:dispose'); },
			encode: async () => ({ bytes: Uint8Array.of(1), mimeType: plan.mimeType }),
			encodeFile: async (_file: Blob, format: string, settings: Readonly<Record<string, unknown>>) => {
				ffmpegSettings.push(settings);
				ffmpegArgs.push(buildMediaFfmpegEncoderArgs('staged.wav', `output.${plan.encoding.extension}`, format, settings));
				events.push('ffmpeg:encode-file');
				return { bytes: Uint8Array.of(1, 2, 3), mimeType: plan.mimeType };
			},
			async encodeFileToSink(_file: Blob, format: string, sink: FfmpegOutputSink<unknown>, settings: Readonly<Record<string, unknown>>) {
				assert.equal(format, plan.format);
				ffmpegSettings.push(settings);
				ffmpegArgs.push(buildMediaFfmpegEncoderArgs('staged.wav', `output.${plan.encoding.extension}`, format, settings));
				events.push('ffmpeg:stat');
				(settings.assertCurrent as () => void)();
				await sink.open(5);
				await sink.write(Uint8Array.of(1, 2));
				await sink.write(Uint8Array.of(3, 4, 5));
				const output = await sink.close();
				if (options.failure === 'drift') plan.outputs[0].fileName = `changed.${plan.encoding.extension}`;
				events.push('ffmpeg:cleanup');
				return { output, byteLength: 5, chunkCount: 2, extension: `.${plan.encoding.extension}`, mimeType: options.failure === 'result' ? 'audio/wrong' : plan.mimeType };
			},
		},
		fileService: {
			prepareSave: () => { events.push('picker'); if (mode === 'stream') return target; if (mode === 'cancelled') return { mode: 'cancelled', cancelled: true }; return { mode: 'blob' }; },
			createDownload: async (request: Readonly<Record<string, unknown>>) => { downloads.push(request); return { cancelled: false, url: 'blob:fallback', method: 'memory', cleanup: async () => undefined }; },
		},
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => false,
		lifetime: { startTask: () => { taskController = new AbortController(); return { signal: taskController.signal, assertCurrent: () => undefined, finish: () => undefined }; }, cancelTask: () => { taskController?.abort(); } },
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
	return { downloads, encoderOptions, errors, events, ffmpegArgs, ffmpegSettings, plan, preflightBytes, runtime, stagedPcm, state, statuses, target };
}

function actualPlan(format: string, options: Readonly<Record<string, unknown>> = {}) {
	return createExportPlan(realtimeProject(), {
		mode: 'mix', format, includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		metadata: { artist: 'Codex' }, date: '2026-08-02', ...options,
	}) as unknown as ServicePlan;
}

function preparedTarget(fileName: () => string, events: string[], onCommit?: () => PromiseLike<void> | void) {
	let byteLength = 0;
	let opens = 0;
	let aborts = 0;
	let commits = 0;
	return {
		mode: 'stream' as const,
		async createWritable() { opens += 1; events.push('target:open'); return new WritableStream<Uint8Array>({ write(chunk) { byteLength += chunk.byteLength; }, close() { events.push('target:close'); } }); },
		bytesWritten: () => byteLength,
		async commit() { commits += 1; events.push('target:commit'); await onCommit?.(); return { method: 'memory', fileName: fileName(), size: byteLength }; },
		async abort() { aborts += 1; events.push('target:abort'); },
		opens: () => opens, aborts: () => aborts, commits: () => commits,
	};
}

function caseFor(format: string): ServiceCase {
	return SERVICE_CASES.find((entry) => entry.format === format)!;
}

function assertOrdered(events: readonly string[], before: string, after: string, message: string): void {
	assert.ok(events.indexOf(before) < events.indexOf(after), `${message}: ${before} before ${after}`);
}

function assertPcmClose(
	actual: readonly Float32Array[],
	expected: readonly (readonly number[])[],
	message: string,
): void {
	assert.equal(actual.length, expected.length, message);
	for (let channel = 0; channel < expected.length; channel += 1) {
		assert.equal(actual[channel]!.length, expected[channel]!.length, `${message}: channel ${channel}`);
		for (let frame = 0; frame < expected[channel]!.length; frame += 1) {
			assert.ok(
				Math.abs(actual[channel]![frame]! - expected[channel]![frame]!) < 1e-6,
				`${message}: channel ${channel}, frame ${frame}`,
			);
		}
	}
}

function deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value?: Value | PromiseLike<Value>) => void } {
	let resolve!: (value?: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept as typeof resolve; });
	return { promise, resolve };
}

function realtimeProject() {
	return {
		schemaVersion: 9, id: 'direct-compressed-service-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: 1 }, loop: { enabled: false, startFrame: 0, endFrame: 1 },
		sources: [{ id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav', frameCount: 1, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 1 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}

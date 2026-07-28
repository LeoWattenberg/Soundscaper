/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';

interface TestProject {
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: Array<{ id: string; type: string; hidden?: boolean; clipIds: string[] }>;
	readonly clips: Array<{ id: string; kind: string; sourceId: string }>;
	readonly sources: Array<{ id: string; opaqueExtensions?: { byteLength?: number } }>;
}

interface TestPlan extends Record<string, unknown> {
	mode: string;
	outputs: Array<{ fileName: string; trackId: string }>;
	outputBytesPerRender: number;
	archiveName: string;
	format: string;
	mimeType: string;
	sampleRate: number;
	channelCount: number;
	encoding: {
		bitDepth?: number;
		floatingPoint?: boolean;
		sampleFormat?: string;
	};
	ditherMode: string;
	render: { strategy: string };
	range: { startFrame: number; endFrame: number; durationFrames: number };
	tailFrames: number;
	outputFrames: number;
	channelMapping: unknown;
	bext?: Readonly<Record<string, unknown>>;
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

function defaultProject(): TestProject {
	return {
		id: 'project',
		title: '  Café / Film -- ',
		sampleRate: 48_000,
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }],
		clips: [
			{ id: 'video-clip', kind: 'video', sourceId: 'video-source' },
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source' },
		],
		sources: [{ id: 'video-source', opaqueExtensions: { byteLength: 2_048 } }],
	};
}

function defaultPlan(): TestPlan {
	return {
		mode: 'mix',
		outputs: [{ fileName: 'mix.wav', trackId: 'video-track' }],
		outputBytesPerRender: 128,
		archiveName: 'stems.zip',
		format: 'wav',
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 2,
		encoding: { bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' },
		ditherMode: 'none',
		render: { strategy: 'offline' },
		range: { startFrame: 1, endFrame: 5, durationFrames: 4 },
		tailFrames: 2,
		outputFrames: 6,
		channelMapping: { mode: 'stereo' },
		metadata: { title: 'Mix' },
	};
}

function createFixture() {
	const calls: string[] = [];
	const errors: unknown[] = [];
	const statuses: Array<[string, unknown]> = [];
	const downloads: Array<Record<string, unknown>> = [];
	const progress: number[] = [];
	const wavOptions: Array<Record<string, unknown>> = [];
	const streamEncoderOptions: Array<Record<string, unknown>> = [];
	const audio = {
		sampleRate: 48_000,
		length: 4,
		numberOfChannels: 2,
		channels: [Float32Array.of(0.1, 0.2), Float32Array.of(0.2, 0.1)],
	};
	let project = defaultProject();
	let plan = defaultPlan();
	let missingSources = false;
	let archiveAddFails = false;
	let preflightFails = false;
	let publishCancelled = false;
	let disposeDuringPublish = false;
	let mediaAvailable = true;
	let sinkPersistent = true;
	let realtimeThrows = false;
	let currentController: AbortController | null = null;
	const sourceBuffers = new Map<string, unknown>([['audio-source', audio]]);
	const state: ExportState = {
		exportGeneration: 0,
		exportAbort: null,
		mobile: false,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
	const throwIfAborted = (signal?: AbortSignal | null) => {
		if (signal?.aborted) throw abortError();
	};
	const renderEngine = () => ({
		loadProject: () => { calls.push('load-project'); },
		renderMix: async () => audio,
		async renderMixRealtime(range: {
			onChunk: (channels: Float32Array[], metadata?: { sampleRate?: number }) => void;
		}) {
			calls.push('render-realtime');
			if (realtimeThrows) throw new Error('realtime failed');
			range.onChunk(audio.channels, { sampleRate: 44_100 });
			return { sampleRate: 44_100 };
		},
		dispose: async () => { calls.push('dispose-renderer'); },
	});
	const streamEncoder = (encoderOptions: { onChunk: (chunk: Uint8Array) => Promise<void> }) => {
		streamEncoderOptions.push(encoderOptions as unknown as Record<string, unknown>);
		return ({
		write: (channels: Float32Array[]) => { calls.push(`encode-channels:${channels[0]?.length || 0}`); },
		finalize: () => { void encoderOptions.onChunk(Uint8Array.of(1, 2, 3)); },
		settled: async () => { calls.push('encoder-settled'); },
		});
	};
	const renderOptions: { renderSnapshot?: (...args: unknown[]) => Promise<typeof audio> } = {
		renderSnapshot: async () => audio,
	};
	const runtime: ExportServiceRuntime = {
		abortError,
		applyMediaChannelMapping: (channels: Float32Array[]) => channels,
		audioBufferChannels: (value: typeof audio) => value.channels,
		cloneProject: (value: TestProject) => structuredClone(value),
		copy: {
			localSourcesMissing: 'Local sources missing.',
			rendering: 'Rendering',
			encoding: 'Encoding',
			done: 'Done',
			largeProjectRealtimeExport: 'Realtime export',
			realtimeExportFallback: 'Realtime fallback',
			realtimeStorageRequired: 'Realtime storage required',
		},
		createAiffStreamEncoder: streamEncoder,
		createCacheAwareRenderEngine: renderEngine,
		createExportPlan: () => plan,
		createStableId: () => 'stable',
		createStreamingWindowedSincResampler: () => ({
			push: (channels: Float32Array[]) => channels,
			finish: () => [Float32Array.of(0.5), Float32Array.of(0.5)],
		}),
		createStreamingZipArchive: async () => ({
			async add(fileName: string) {
				calls.push(`archive-add:${fileName}`);
				if (archiveAddFails) throw new Error('archive add failed');
			},
			async finish() {
				calls.push('archive-finish');
				return {
					blob: new Blob([Uint8Array.of(9)], { type: 'application/zip' }),
					cleanup: async () => { calls.push('archive-cleanup'); },
				};
			},
			async abort() { calls.push('archive-abort'); },
		}),
		createTemporaryFileSink: async () => ({
			persistent: sinkPersistent,
			write: async () => { calls.push('sink-write'); },
			close: async (mimeType: string) => new Blob([Uint8Array.of(7)], { type: mimeType }),
			remove: async () => { calls.push('sink-remove'); },
			abort: async () => { calls.push('sink-abort'); },
		}),
		createVideoExportPlan: (_value: TestProject, settings: { format: string }) => ({
			inputs: [{ kind: 'video-source', sourceId: 'video-source', storageKey: '' }, { kind: 'other' }],
			range: { startFrame: 2, endFrame: 6, durationFrames: 4 },
			extension: settings.format === 'webm' ? 'webm' : 'mp4',
		}),
		createWavStreamEncoder: streamEncoder,
		encodeAiff: () => Uint8Array.of(4, 5),
		encodeWav: (_channels: Float32Array[], options: Record<string, unknown>) => {
			wavOptions.push(options);
			return Uint8Array.of(1, 2, 3);
		},
		ffmpeg: {
			dispose: () => { calls.push('ffmpeg-dispose'); },
			encode: async (_bytes: unknown, format: string) => ({
				bytes: Uint8Array.of(6), mimeType: `audio/${format}`,
			}),
			encodeFile: async (_blob: Blob, format: string) => ({
				bytes: Uint8Array.of(8), mimeType: `audio/${format}`,
			}),
			encodeVideo: async (_video: unknown, audioMix: Blob | null) => {
				calls.push(`video-audio:${Boolean(audioMix)}`);
				return { bytes: Uint8Array.of(1, 2), mimeType: 'video/mp4' };
			},
		},
		fileService: {
			createDownload: async (download: Record<string, unknown>) => {
				downloads.push(download);
				if (disposeDuringPublish) state.disposed = true;
				return {
					cancelled: publishCancelled,
					url: publishCancelled ? null : 'blob:result',
					fileName: null,
					method: 'memory',
					cleanup: async () => { calls.push('download-cleanup'); },
				};
			},
		},
		findClip: (value: TestProject, clipId: string) => value.clips.find((clip) => clip.id === clipId),
		findSource: (value: TestProject, sourceId: string) => value.sources.find((source) => source.id === sourceId),
		handleError: (error: unknown) => { errors.push(error); },
		hasMissingTimelineSources: () => missingSources,
		lifetime: {
			startTask: () => {
				currentController = new AbortController();
				return {
					signal: currentController.signal,
					assertCurrent: () => { calls.push('assert-task'); },
					finish: () => { calls.push('finish-task'); },
				};
			},
			cancelTask: () => { currentController?.abort(); },
		},
		normalizeExportSettings: (settings: unknown) => settings,
		normalizeProjectSampleRate: (sampleRate: number) => sampleRate,
		options: renderOptions,
		preflightStorage: async () => {
			if (preflightFails) throw new Error('preflight failed');
		},
		prepareCommittedTimePitchCaches: async () => { calls.push('prepare-caches'); },
		getProject: () => project,
		projectGeneration: {
			capture: (projectId: string) => projectId,
			assertCurrent: () => { calls.push('assert-project'); },
		},
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { calls.push('publish'); },
		resampleBuffer: async () => ({ ...audio, sampleRate: plan.sampleRate }),
		setStatus: (message: string, tone?: unknown) => { statuses.push([message, tone]); },
		sourceBuffers,
		state,
		stemProject: (value: TestProject) => structuredClone(value),
		store: {
			loadMediaAsset: async () => mediaAvailable ? new Blob([Uint8Array.of(1)]) : null,
		},
		throwIfAborted,
		toggleExport: (active: boolean) => { calls.push(`toggle:${active}`); },
		updateExportProgress: (value: number) => { progress.push(value); },
	};
	return {
		calls,
		downloads,
		errors,
		progress,
		renderOptions,
		runtime,
		state,
		statuses,
		streamEncoderOptions,
		wavOptions,
		setArchiveAddFails: (value: boolean) => { archiveAddFails = value; },
		setDisposeDuringPublish: (value: boolean) => { disposeDuringPublish = value; },
		setMediaAvailable: (value: boolean) => { mediaAvailable = value; },
		setMissingSources: (value: boolean) => { missingSources = value; },
		setPlan: (value: TestPlan) => { plan = value; },
		setPreflightFails: (value: boolean) => { preflightFails = value; },
		setProject: (value: TestProject) => { project = value; },
		setPublishCancelled: (value: boolean) => { publishCancelled = value; },
		setRealtimeThrows: (value: boolean) => { realtimeThrows = value; },
		setSinkPersistent: (value: boolean) => { sinkPersistent = value; },
	};
}

test('export action cancellation and preconditions preserve idle state', async () => {
	const fixture = createFixture();
	let aborted = false;
	fixture.state.exportAbort = { signal: new AbortController().signal, abort: () => { aborted = true; } };
	await createEditorExportService(fixture.runtime).handleExportAction('cancel');
	assert.equal(aborted, true);
	assert.equal(fixture.state.exportAbort, null);
	assert.equal(fixture.calls.includes('ffmpeg-dispose'), true);

	const empty = createFixture();
	empty.setProject({ ...defaultProject(), clips: [] });
	assert.equal(await createEditorExportService(empty.runtime).handleExportAction('export'), undefined);

	const busy = createFixture();
	busy.state.exportAbort = { signal: new AbortController().signal, abort: () => undefined };
	assert.equal(await createEditorExportService(busy.runtime).handleExportAction('export'), undefined);

	const missing = createFixture();
	missing.setMissingSources(true);
	await assert.rejects(
		() => createEditorExportService(missing.runtime).handleExportAction('export'),
		/Local sources missing/iu,
	);
});

test('offline WAV and AIFF exports replace prior output and chain cleanup', async () => {
	const fixture = createFixture();
	fixture.state.outputUrl = 'blob:old';
	fixture.state.outputCleanup = async () => { fixture.calls.push('old-cleanup'); };
	const service = createEditorExportService(fixture.runtime);
	const output = await service.handleExportAction('export', { includeTail: true, bitDepth: 32 });
	assert.equal(output.fileName, 'mix.wav');
	assert.equal(output.mimeType, 'audio/wav');
	assert.equal(fixture.calls.includes('old-cleanup'), true);
	assert.deepEqual(fixture.statuses.at(-1), ['Done', 'success']);
	await fixture.state.outputCleanup?.();
	assert.equal(fixture.calls.includes('download-cleanup'), true);

	const aiff = defaultPlan();
	aiff.format = 'aiff';
	aiff.mimeType = 'audio/aiff';
	aiff.outputs = [{ fileName: 'mix.aiff', trackId: 'video-track' }];
	aiff.sampleRate = 44_100;
	fixture.setPlan(aiff);
	fixture.state.disposed = false;
	const aiffOutput = await service.handleExportAction('export', { bitDepth: 16 });
	assert.equal(aiffOutput.fileName, 'mix.aiff');
	assert.equal(fixture.downloads.at(-1)?.mimeType, 'audio/aiff');
});

test('offline and realtime BWF exports pass final file-level BEXT metadata to the WAV encoder', async () => {
	const bext = { description: 'Broadcast master', timeReference: '66150', version: 2 };
	const offline = createFixture();
	const offlinePlan = defaultPlan();
	offlinePlan.format = 'bwf';
	offlinePlan.bext = bext;
	offlinePlan.encoding = { ...offlinePlan.encoding };
	offline.setPlan(offlinePlan);
	const offlineResult = await createEditorExportService(offline.runtime).handleExportAction('export');
	assert.equal(offlineResult.mimeType, 'audio/wav');
	assert.deepEqual(offline.wavOptions.at(-1)?.bext, bext);

	const realtime = createFixture();
	const realtimePlan = { ...offlinePlan, render: { strategy: 'realtime-stream' } };
	realtime.setPlan(realtimePlan);
	const realtimeResult = await createEditorExportService(realtime.runtime).handleExportAction('export');
	assert.equal(realtimeResult.mimeType, 'audio/wav');
	assert.deepEqual(realtime.streamEncoderOptions.at(-1)?.bext, bext);
});

test('compressed exports stage PCM and return publisher cancellation cleanly', async () => {
	const fixture = createFixture();
	const compressed = defaultPlan();
	compressed.format = 'mp3';
	compressed.mimeType = 'audio/mpeg';
	compressed.encoding = { sampleFormat: 'int24' };
	compressed.ditherMode = 'triangular';
	compressed.outputs = [{ fileName: 'mix.mp3', trackId: 'video-track' }];
	fixture.setPlan(compressed);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', { bitDepth: 16 });
	assert.equal(result.mimeType, 'audio/mp3');
	assert.equal(fixture.statuses.some(([message]) => message === 'Encoding'), true);

	fixture.setPublishCancelled(true);
	const cancelled = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(cancelled.cancelled, true);
	assert.equal(fixture.state.outputUrl, null);
});

test('stem exports archive each output, report progress, and abort failed archives', async () => {
	const fixture = createFixture();
	const stems = defaultPlan();
	stems.mode = 'stems';
	stems.outputs = [
		{ fileName: 'one.wav', trackId: 'one' },
		{ fileName: 'two.wav', trackId: 'two' },
	];
	fixture.setPlan(stems);
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.fileName, 'stems.zip');
	assert.deepEqual(fixture.progress, [0.5, 1]);
	assert.equal(fixture.calls.filter((entry) => entry.startsWith('archive-add')).length, 2);

	const failed = createFixture();
	failed.setPlan(stems);
	failed.setArchiveAddFails(true);
	assert.equal(await createEditorExportService(failed.runtime).handleExportAction('export'), undefined);
	assert.equal(failed.calls.includes('archive-abort'), true);
	assert.match((failed.errors[0] as Error).message, /archive add failed/u);
});

test('realtime exports stream native PCM and transcode staged compressed formats', async () => {
	const native = createFixture();
	const nativePlan = defaultPlan();
	nativePlan.render = { strategy: 'realtime-stream' };
	native.setPlan(nativePlan);
	const nativeResult = await createEditorExportService(native.runtime).handleExportAction('export', { includeTail: true });
	assert.equal(nativeResult.mimeType, 'audio/wav');
	assert.equal(native.calls.includes('sink-write'), true);
	assert.equal(native.calls.includes('render-realtime'), true);
	await native.state.outputCleanup?.();
	assert.equal(native.calls.includes('sink-remove'), true);

	const flac = createFixture();
	const flacPlan = defaultPlan();
	flacPlan.render = { strategy: 'realtime-stream' };
	flacPlan.format = 'flac';
	flacPlan.mimeType = 'audio/flac';
	flacPlan.encoding = { bitDepth: 24, sampleFormat: 'int24' };
	flacPlan.outputs = [{ fileName: 'mix.flac', trackId: 'one' }];
	flac.setPlan(flacPlan);
	const flacResult = await createEditorExportService(flac.runtime).handleExportAction('export', { bitDepth: 24 });
	assert.equal(flacResult.mimeType, 'audio/flac');
	assert.equal(flac.calls.includes('sink-remove'), true);
});

test('realtime export handles storage requirements and renderer failures', async () => {
	const storage = createFixture();
	const huge = defaultPlan();
	huge.render = { strategy: 'realtime-stream' };
	huge.outputBytesPerRender = 97 * 1024 ** 2;
	storage.setPlan(huge);
	storage.setSinkPersistent(false);
	assert.equal(await createEditorExportService(storage.runtime).handleExportAction('export'), undefined);
	assert.equal(storage.calls.includes('sink-abort'), true);
	assert.match((storage.errors[0] as Error).message, /storage required/u);

	const renderer = createFixture();
	const realtime = defaultPlan();
	realtime.render = { strategy: 'realtime-stream' };
	renderer.setPlan(realtime);
	renderer.setRealtimeThrows(true);
	await createEditorExportService(renderer.runtime).handleExportAction('export');
	assert.equal(renderer.calls.includes('sink-abort'), true);
	assert.match((renderer.errors[0] as Error).message, /realtime failed/u);
});

test('offline renderer failures fall back to the realtime export path', async () => {
	const fixture = createFixture();
	fixture.renderOptions.renderSnapshot = async () => { throw new Error('offline failed'); };
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export');
	assert.equal(result.mimeType, 'audio/wav');
	assert.equal(fixture.statuses.some(([message]) => message === 'Realtime fallback'), true);
});

test('renderSnapshot supports both injected and owned render engines', async () => {
	const fixture = createFixture();
	const service = createEditorExportService(fixture.runtime);
	assert.equal(await service.renderSnapshot(defaultProject(), { startFrame: 0, endFrame: 1 }), await fixture.renderOptions.renderSnapshot?.());
	fixture.renderOptions.renderSnapshot = undefined;
	const rendered = await service.renderSnapshot(defaultProject(), { startFrame: 0, endFrame: 1 });
	assert.equal(rendered.sampleRate, 48_000);
	assert.equal(fixture.calls.includes('prepare-caches'), true);
	assert.equal(fixture.calls.includes('load-project'), true);
	assert.equal(fixture.calls.includes('dispose-renderer'), true);
});

test('video export loads media, mixes audio, sanitizes names, and publishes output', async () => {
	const fixture = createFixture();
	const result = await createEditorExportService(fixture.runtime).handleExportAction('export', {
		format: 'video-mp4', range: 'project', canvas: { width: 1_920 },
	});
	assert.equal(result.fileName, 'Cafe-Film.mp4');
	assert.equal(result.mimeType, 'video/mp4');
	assert.equal(fixture.calls.includes('video-audio:true'), true);
	assert.equal(fixture.downloads.at(-1)?.purpose, 'video');
});

test('video export supports silent cancellation and reports missing media', async () => {
	const silent = createFixture();
	silent.setProject({
		...defaultProject(),
		title: '---',
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source' }],
	});
	silent.setPublishCancelled(true);
	const cancelled = await createEditorExportService(silent.runtime).exportVideo({ format: 'video-webm' });
	assert.equal(cancelled.cancelled, true);
	assert.equal(silent.calls.includes('video-audio:false'), true);
	assert.equal(silent.downloads.at(-1)?.suggestedName, 'video-project.webm');

	const missingMedia = createFixture();
	missingMedia.setMediaAvailable(false);
	assert.equal(await createEditorExportService(missingMedia.runtime).exportVideo(), null);
	assert.match((missingMedia.errors[0] as Error).message, /Local sources missing/iu);

	const preflight = createFixture();
	preflight.setPreflightFails(true);
	assert.equal(await createEditorExportService(preflight.runtime).exportVideo(), null);
	assert.match((preflight.errors[0] as Error).message, /preflight failed/u);
});

test('video export validates the timeline and cleans late publications', async () => {
	const absent = createFixture();
	absent.setProject({ ...defaultProject(), tracks: [{ id: 'audio', type: 'audio', clipIds: [] }] });
	await assert.rejects(
		() => createEditorExportService(absent.runtime).exportVideo(),
		/Add a visible video clip/iu,
	);

	const hidden = createFixture();
	hidden.setProject({ ...defaultProject(), tracks: [{ id: 'video', type: 'video', hidden: true, clipIds: ['video-clip'] }] });
	await assert.rejects(
		() => createEditorExportService(hidden.runtime).exportVideo(),
		/Add a visible video clip/iu,
	);

	const missing = createFixture();
	missing.setMissingSources(true);
	await assert.rejects(
		() => createEditorExportService(missing.runtime).exportVideo(),
		/Local sources missing/iu,
	);

	const late = createFixture();
	late.setDisposeDuringPublish(true);
	assert.equal(await createEditorExportService(late.runtime).exportVideo(), null);
	assert.equal(late.calls.includes('download-cleanup'), true);
	assert.equal(late.errors.length, 0);
});

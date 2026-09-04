/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Shared fixture for the export-service suites.
 *
 * The runtime this builds is fully injected, so a suite can drive a real
 * export end to end and observe exactly what the service did.
 */

import { type ExportServiceRuntime } from '../../src/common/editor/controller/export-service.ts';
import type { FfmpegOutputSink } from '../../src/common/editor/ffmpeg-output-stream.ts';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { encodeWav } from '../../src/common/editor/wav.js';

export interface TestProject {
	readonly id: string;
	readonly title: string;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly tracks: Array<{ id: string; type: string; hidden?: boolean; clipIds: string[] }>;
	readonly clips: Array<{ id: string; kind: string; sourceId: string }>;
	readonly sources: Array<{ id: string; opaqueExtensions?: { byteLength?: number } }>;
}

export interface TestPlan extends Record<string, unknown> {
	mode: string;
	/** `kind` is what a stems delivery states on each member, as the plan does. */
	outputs: Array<{
		fileName: string;
		trackId: string | null;
		kind?: string;
		includeMaster?: boolean;
		respectMuteSolo?: boolean;
		/** A chapter delivers its own span, so it states one; stems do not. */
		range?: { startFrame: number; endFrame: number; durationFrames: number };
		outputFrames?: number;
		outputFileBytes?: number | null;
	}>;
	outputBytesPerRender: number;
	requiredTemporaryBytes: number;
	archive: null | {
		format: 'zip' | '7z';
		fileName: string;
		mimeType: string;
		expectedByteLength: number | null;
		entries: Array<{ fileName: string; expectedByteLength: number | null }>;
	};
	format: string;
	mimeType: string;
	sampleRate: number;
	channelCount: number;
	encoding: {
		bitDepth?: number;
		floatingPoint?: boolean;
		sampleFormat?: string;
		compressionLevel?: number;
		quality?: number;
		bitRate?: number;
	};
	ditherMode: string;
	render: { strategy: string };
	range: { startFrame: number; endFrame: number; durationFrames: number };
	tailFrames: number;
	outputFrames: number;
	channelMapping: unknown;
	bext?: Readonly<Record<string, unknown>>;
}

export interface ExportState {
	exportGeneration: number;
	exportAbort: null | { readonly signal: AbortSignal; abort(): void };
	mobile: boolean;
	outputUrl: string | null;
	outputCleanup: null | (() => Promise<void>);
	exportOutput: unknown;
	disposed: boolean;
	deliveryReport?: unknown;
}

export function defaultProject(): TestProject {
	return {
		id: 'project',
		title: '  Café / Film -- ',
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }],
		clips: [
			{ id: 'video-clip', kind: 'video', sourceId: 'video-source' },
			{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source' },
		],
		sources: [{ id: 'video-source', opaqueExtensions: { byteLength: 2_048 } }],
	};
}

export function defaultPlan(): TestPlan {
	return {
		mode: 'mix',
		outputs: [{
			fileName: 'mix.wav', trackId: null,
			includeMaster: true, respectMuteSolo: true,
		}],
		outputBytesPerRender: 128,
		requiredTemporaryBytes: 256,
		archive: null,
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

export function createFixture() {
	const calls: string[] = [];
	const errors: unknown[] = [];
	const statuses: Array<[string, unknown]> = [];
	const downloads: Array<Record<string, unknown>> = [];
	const progress: number[] = [];
	const wavOptions: Array<Record<string, unknown>> = [];
	const streamEncoderOptions: Array<Record<string, unknown>> = [];
	const preflightBytes: number[] = [];
	const resampleFrameRequests: number[] = [];
	const encodedFrameCounts: number[] = [];
	const encodedChannelCounts: number[] = [];
	const realtimeRenderOptions: Array<Record<string, unknown>> = [];
	// Exactly the plan's `outputFrames`. A render that disagrees with its plan is
	// the defect conformance reopens the file to catch, so a fixture that ships
	// the disagreement cannot also stand for an ordinary delivery.
	const audio = {
		sampleRate: 48_000,
		length: 6,
		numberOfChannels: 2,
		channels: [
			Float32Array.of(0.1, 0.2, 0.3, 0.2, 0.1, 0),
			Float32Array.of(0.2, 0.1, 0, 0.1, 0.2, 0.3),
		],
	};
	let project = defaultProject();
	let plan = defaultPlan();
	let corruptOutput = false;
	function stagedContainerBytes(): Uint8Array<ArrayBuffer> {
		if (plan.format !== 'wav' && plan.format !== 'bwf' && plan.format !== 'bw64') return Uint8Array.of(7);
		const staged = stagedWavBytes();
		// The same corruption the offline path can be told to produce, so a
		// realtime delivery can also be conformed against bytes that are not the
		// file the plan described.
		return corruptOutput
			? staged.subarray(0, Math.max(0, staged.byteLength - 6)) as Uint8Array<ArrayBuffer>
			: staged;
	}
	function stagedWavBytes(): Uint8Array<ArrayBuffer> {
		return encodeWav(
			Array.from({ length: plan.channelCount }, () => new Float32Array(plan.outputFrames)),
			{
				sampleRate: plan.sampleRate,
				bitDepth: (plan.encoding.bitDepth ?? 24) as 24,
				float: plan.encoding.floatingPoint === true,
				dither: 'none',
				...(plan.bext ? { bext: plan.bext } : {}),
			},
		) as Uint8Array<ArrayBuffer>;
	}
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
			onProgress?: (progress: Readonly<{ progress: number }>) => void;
		}) {
			realtimeRenderOptions.push(range as unknown as Record<string, unknown>);
			calls.push('render-realtime');
			if (realtimeThrows) throw new Error('realtime failed');
			range.onProgress?.({ progress: 0.25 });
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
		createStreamingStemArchive: async (archivePlan: NonNullable<TestPlan['archive']>) => {
			calls.push(`archive-create:${archivePlan.format}:${archivePlan.fileName}`);
			return {
				async add(fileName: string) {
					calls.push(`archive-add:${fileName}`);
					if (archiveAddFails) throw new Error('archive add failed');
				},
				async finish() {
					calls.push('archive-finish');
					return {
						blob: new Blob([Uint8Array.of(9)], { type: archivePlan.mimeType }),
						cleanup: async () => { calls.push('archive-cleanup'); },
					};
				},
				async abort() { calls.push('archive-abort'); },
			};
		},
		createTemporaryFileSink: async () => ({
			persistent: sinkPersistent,
			write: async () => { calls.push('sink-write'); },
			// A realtime delivery is conformed by reopening the file the sink
			// produced, so the sink produces the container the plan describes
			// rather than a placeholder byte.
			close: async (mimeType: string) => new Blob([stagedContainerBytes()], { type: mimeType }),
			remove: async () => { calls.push('sink-remove'); },
			abort: async () => { calls.push('sink-abort'); },
		}),
		// The staged audio input carries the layout the delivery asked for, exactly
		// as a real plan does: it is what the service reads the downmix off, and a
		// plan that dropped it would make that wiring untestable here.
		createVideoExportPlan: (
			_value: TestProject,
			settings: { format: string; audioLayout?: string },
		) => ({
			inputs: [
				{ kind: 'video-source', sourceId: 'video-source', storageKey: '' },
				{ kind: 'staged-audio-mix', channelLayout: settings.audioLayout ?? 'preserve' },
			],
			range: { startFrame: 2, endFrame: 6, durationFrames: 4 },
			extension: settings.format === 'webm' ? 'webm' : 'mp4',
		}),
		createWavStreamEncoder: streamEncoder,
		// The real encoders, because a delivery is conformed by reopening what it
		// wrote: a fixture that claims to write WAV and returns three bytes is
		// exactly the writer fault conformance exists to catch.
		encodeAiff: (channels: Float32Array[], options: Record<string, unknown>) => (
			encodeAiff(channels, options as never)
		),
		encodeWav: (channels: Float32Array[], options: Record<string, unknown>) => {
			encodedFrameCounts.push(channels[0]?.length ?? 0);
			encodedChannelCounts.push(channels.length);
			wavOptions.push(options);
			const bytes = encodeWav(channels, options as never);
			// The corruption a delivery has to survive being told about: bytes that
			// left the encoder and are not the file the plan described.
			return corruptOutput ? bytes.subarray(0, Math.max(0, bytes.byteLength - 6)) : bytes;
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
		preflightStorage: async (bytes: number) => {
			preflightBytes.push(bytes);
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
		resampleBuffer: async (
			_input: unknown,
			_sampleRate: number,
			_context: unknown,
			_copy: unknown,
			outputFrames: number,
		) => {
			resampleFrameRequests.push(outputFrames);
			return {
				...audio,
				sampleRate: plan.sampleRate,
				length: outputFrames,
				channels: [new Float32Array(outputFrames), new Float32Array(outputFrames)],
			};
		},
		setStatus: (message: string, tone?: unknown) => { statuses.push([message, tone]); },
		sourceBuffers,
		state,
		stemProject: (value: TestProject) => structuredClone(value),
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			getSnapshot: () => ({ kind: 'export' }),
			setActivePhase: () => true,
			updateActive: () => true,
		},
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
		preflightBytes,
		resampleFrameRequests,
		encodedFrameCounts,
		encodedChannelCounts,
		renderOptions,
		realtimeRenderOptions,
		runtime,
		state,
		statuses,
		streamEncoderOptions,
		wavOptions,
		setArchiveAddFails: (value: boolean) => { archiveAddFails = value; },
		setCorruptOutput: (value: boolean) => { corruptOutput = value; },
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

export function legacyVideoFfmpegFixture(events: string[]) {
	return Object.freeze({
		async encodeVideo(
			_videoBlobs: unknown,
			_audioMix: unknown,
			plan: Readonly<{ mimeType: string }>,
		) {
			events.push('legacy-encode');
			return { bytes: Uint8Array.of(1, 2, 3, 4), mimeType: plan.mimeType };
		},
		async encodeVideoToSink(
			_videoBlobs: unknown, _audioMix: unknown,
			plan: Readonly<{ extension: string; mimeType: string }>, sink: FfmpegOutputSink<unknown>,
		) {
			events.push('legacy-encode');
			await sink.open(4); await sink.write(Uint8Array.of(1, 2, 3, 4));
			const output = await sink.close();
			return { output, byteLength: 4, chunkCount: 1, extension: `.${plan.extension}`, mimeType: plan.mimeType };
		},
	});
}

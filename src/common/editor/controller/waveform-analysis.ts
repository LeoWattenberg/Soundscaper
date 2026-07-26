import { analyzeAudioChannels } from '../analysis.js';
import { abortError, throwIfAborted } from './app-helpers.ts';

export const WAVEFORM_PEAKS_VERSION = 4;
export const WAVEFORM_PEAK_CACHE_PREFIX = 'audio-editor-peaks-v2:';
export const WAVEFORM_PEAK_BLOCK_SIZES = Object.freeze([8, 16, 32, 64, 256, 1_024, 4_096, 16_384, 65_536]);

interface WorkerCopy {
	readonly audioAnalysisWorkerFailed: string;
	readonly audioAnalysisFailed: string;
}

interface WaveformSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly frameCount: number;
	readonly channelCount: number;
}

interface StoredPcmChunk {
	readonly channels: Float32Array[];
	readonly frames: number;
}

interface WaveformChunkValue {
	readonly channels: Float32Array[];
	readonly frames?: number;
}

interface StoredWaveformStore {
	readSourceChunks(sourceId: string): AsyncIterable<StoredPcmChunk>;
}

interface ClipSourceWindow {
	readonly durationFrames?: unknown;
	readonly sourceDurationFrames?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly reversed?: boolean;
}

export interface WaveformPcmRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

interface WaveformPcmProvider {
	readonly channelCount: number;
	readonly chunkFrames: number;
	readStorageChunk(chunkIndex: number): Promise<WaveformChunkValue | Float32Array[]> | WaveformChunkValue | Float32Array[];
}

export interface WaveformPeakChannel {
	readonly minimums: Float32Array;
	readonly maximums: Float32Array;
	readonly rms: Float32Array;
}

export interface WaveformPeakLevel {
	readonly blockSize: number;
	readonly channels: WaveformPeakChannel[];
}

export interface WaveformPeaks {
	readonly version: number;
	readonly channelCount: number;
	readonly levels: WaveformPeakLevel[];
}

interface AnalysisWorkerMessage extends Record<string, unknown> {
	readonly type?: string;
	readonly message?: string;
	readonly result?: unknown;
	readonly levels?: WaveformPeakLevel[];
}

export function clipSourceWindowRange(
	clip: ClipSourceWindow,
	startFrame: number,
	endFrame: number,
	sourceFrameCount: number,
): WaveformPcmRange {
	const durationFrames = Math.max(1, Number(clip.durationFrames) || 1);
	const sourceDurationFrames = Math.max(1, Number(clip.sourceDurationFrames) || durationFrames);
	const sourceFramesPerTimelineFrame = sourceDurationFrames / durationFrames;
	const visualStart = startFrame * sourceFramesPerTimelineFrame;
	const visualEnd = endFrame * sourceFramesPerTimelineFrame;
	const sourceStartFrame = Math.max(0, Number(clip.sourceStartFrame) || 0);
	const absoluteStart = sourceStartFrame + (clip.reversed
		? sourceDurationFrames - visualEnd
		: visualStart);
	const absoluteEnd = sourceStartFrame + (clip.reversed
		? sourceDurationFrames - visualStart
		: visualEnd);
	return {
		startFrame: Math.max(0, Math.floor(Math.min(absoluteStart, absoluteEnd)) - 2),
		endFrame: Math.min(sourceFrameCount, Math.ceil(Math.max(absoluteStart, absoluteEnd)) + 2),
	};
}

export function waveformPcmWindowContains(
	window: WaveformPcmRange | null | undefined,
	range: WaveformPcmRange,
): boolean {
	return Boolean(window
		&& window.startFrame <= range.startFrame
		&& window.endFrame >= range.endFrame);
}

export async function readWaveformPcmWindow(
	provider: WaveformPcmProvider,
	range: WaveformPcmRange,
): Promise<Float32Array[]> {
	const output = Array.from(
		{ length: provider.channelCount },
		() => new Float32Array(range.endFrame - range.startFrame),
	);
	const firstChunk = Math.floor(range.startFrame / provider.chunkFrames);
	const lastChunk = Math.max(firstChunk, Math.ceil(range.endFrame / provider.chunkFrames) - 1);
	let outputOffset = 0;
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		const value = await provider.readStorageChunk(chunkIndex);
		const channels = Array.isArray(value) ? value : value.channels;
		const chunkStart = chunkIndex * provider.chunkFrames;
		const from = Math.max(range.startFrame, chunkStart) - chunkStart;
		const to = Math.min(range.endFrame, chunkStart + (channels[0]?.length || 0)) - chunkStart;
		if (to <= from) continue;
		for (let channel = 0; channel < provider.channelCount; channel += 1) {
			output[channel]!.set(channels[channel]!.subarray(from, to), outputOffset);
		}
		outputOffset += to - from;
	}
	if (outputOffset !== range.endFrame - range.startFrame) {
		throw new Error('The waveform PCM window is incomplete.');
	}
	return output;
}

export async function generateStoredWaveformPeaks(
	store: StoredWaveformStore,
	source: WaveformSource,
	copy: WorkerCopy,
): Promise<WaveformPeaks> {
	if (typeof Worker !== 'function') return generateStoredWaveformPeaksFallback(store, source);
	const worker = new Worker(new URL('../peaks-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', channelCount: source.channelCount });
		await waitForAnalysisWorker(worker, 'ready', copy);
		for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
			const channels = chunk.channels.map((channel) => channel.slice());
			const transfer = channels.map((channel) => channel.buffer);
			worker.postMessage({ type: 'chunk', channels: transfer }, transfer);
			await waitForAnalysisWorker(worker, 'ack', copy);
		}
		worker.postMessage({ type: 'finish' });
		const message = await waitForAnalysisWorker(worker, 'result', copy);
		return { version: WAVEFORM_PEAKS_VERSION, channelCount: source.channelCount, levels: message.levels || [] };
	} finally {
		worker.terminate();
	}
}

export async function generateStoredWaveformPeaksFallback(
	store: StoredWaveformStore,
	source: WaveformSource,
): Promise<WaveformPeaks> {
	const levels = WAVEFORM_PEAK_BLOCK_SIZES.map((blockSize) => ({
		blockSize,
		channels: Array.from({ length: source.channelCount }, () => ({
			minimums: new Float32Array(Math.ceil(source.frameCount / blockSize)).fill(1),
			maximums: new Float32Array(Math.ceil(source.frameCount / blockSize)).fill(-1),
			squareSums: new Float64Array(Math.ceil(source.frameCount / blockSize)),
			counts: new Uint32Array(Math.ceil(source.frameCount / blockSize)),
		})),
	}));
	let frameOffset = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
		for (let frame = 0; frame < chunk.frames; frame += 1) {
			const absoluteFrame = frameOffset + frame;
			for (let channel = 0; channel < source.channelCount; channel += 1) {
				const sample = chunk.channels[channel]![frame]!;
				for (const level of levels) {
					const block = Math.floor(absoluteFrame / level.blockSize);
					const channelLevel = level.channels[channel]!;
					channelLevel.minimums[block] = Math.min(channelLevel.minimums[block]!, sample);
					channelLevel.maximums[block] = Math.max(channelLevel.maximums[block]!, sample);
					channelLevel.squareSums[block] += sample * sample;
					channelLevel.counts[block] += 1;
				}
			}
		}
		frameOffset += chunk.frames;
	}
	if (frameOffset !== source.frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
	return {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: source.channelCount,
		levels: levels.map(({ blockSize, channels }) => ({
			blockSize,
			channels: channels.map(({ minimums, maximums, squareSums, counts }) => ({
				minimums,
				maximums,
				rms: Float32Array.from(squareSums, (squareSum, block) => (
					counts[block] ? Math.sqrt(squareSum / counts[block]!) : 0
				)),
			})),
		})),
	};
}

export async function analyzeChannelsInWorker(
	channels: Float32Array[],
	sampleRate: number,
	copy: WorkerCopy,
	chunkFrames = 65_536,
	signal: AbortSignal | null = null,
): Promise<unknown> {
	throwIfAborted(signal);
	if (typeof Worker !== 'function') {
		const result = analyzeAudioChannels(channels, sampleRate);
		throwIfAborted(signal);
		return result;
	}
	const worker = new Worker(new URL('../analysis-worker.js', import.meta.url), { type: 'module' });
	try {
		const ready = waitForAnalysisWorker(worker, 'ready', copy, { signal });
		worker.postMessage({ type: 'start', options: { sampleRate, channelCount: channels.length, truePeakOversample: 4 } });
		await ready;
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			throwIfAborted(signal);
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			const acknowledged = waitForAnalysisWorker(worker, 'ack', copy, { signal });
			const transfer = chunks.map((chunk) => chunk.buffer);
			worker.postMessage({ type: 'chunk', channels: transfer }, transfer);
			await acknowledged;
		}
		const finished = waitForAnalysisWorker(worker, 'result', copy, { signal });
		worker.postMessage({ type: 'finish' });
		return (await finished).result;
	} finally {
		worker.terminate();
	}
}

export async function generateWaveformPeaks(
	channels: Float32Array[],
	copy: WorkerCopy,
	chunkFrames = 65_536,
): Promise<WaveformPeaks> {
	if (typeof Worker !== 'function') return generateWaveformPeaksFallback(channels);
	const worker = new Worker(new URL('../peaks-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', channelCount: channels.length });
		await waitForAnalysisWorker(worker, 'ready', copy);
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			const transfer = chunks.map((chunk) => chunk.buffer);
			worker.postMessage({ type: 'chunk', channels: transfer }, transfer);
			await waitForAnalysisWorker(worker, 'ack', copy);
		}
		worker.postMessage({ type: 'finish' });
		const message = await waitForAnalysisWorker(worker, 'result', copy);
		return { version: WAVEFORM_PEAKS_VERSION, channelCount: channels.length, levels: message.levels || [] };
	} finally {
		worker.terminate();
	}
}

export function generateWaveformPeaksFallback(channels: Float32Array[]): WaveformPeaks {
	return {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: channels.length,
		levels: WAVEFORM_PEAK_BLOCK_SIZES.map((blockSize) => {
			const count = Math.ceil((channels[0]?.length || 0) / blockSize);
			const channelLevels = channels.map((channel) => {
				const minimums = new Float32Array(count);
				const maximums = new Float32Array(count);
				const rms = new Float32Array(count);
				for (let block = 0; block < count; block += 1) {
					let minimum = 1;
					let maximum = -1;
					let squareSum = 0;
					let sampleCount = 0;
					for (let frame = block * blockSize; frame < Math.min(channel.length, (block + 1) * blockSize); frame += 1) {
						const sample = channel[frame]!;
						minimum = Math.min(minimum, sample);
						maximum = Math.max(maximum, sample);
						squareSum += sample * sample;
						sampleCount += 1;
					}
					minimums[block] = minimum;
					maximums[block] = maximum;
					rms[block] = sampleCount ? Math.sqrt(squareSum / sampleCount) : 0;
				}
				return { minimums, maximums, rms };
			});
			return { blockSize, channels: channelLevels };
		}),
	};
}

export function waveformPeaksHaveRms(
	peaks: WaveformPeaks | null | undefined,
	source: Pick<WaveformSource, 'frameCount' | 'channelCount'> | null = null,
): boolean {
	return Boolean(
		peaks?.version === WAVEFORM_PEAKS_VERSION
		&& Number.isSafeInteger(peaks.channelCount)
		&& peaks.channelCount > 0
		&& (!source || peaks.channelCount === source.channelCount)
		&& peaks.levels?.length === WAVEFORM_PEAK_BLOCK_SIZES.length
		&& peaks.levels.every((level, index, levels) => (
			Number.isSafeInteger(level?.blockSize)
			&& level.blockSize === WAVEFORM_PEAK_BLOCK_SIZES[index]
			&& level.blockSize > (levels[index - 1]?.blockSize || 0)
			&& level?.channels?.length === peaks.channelCount
			&& level.channels.every((channel) => (
				channel?.minimums?.length > 0
				&& channel.maximums?.length === channel.minimums.length
				&& channel.rms?.length === channel.minimums.length
				&& (!source || channel.minimums.length === Math.ceil(source.frameCount / level.blockSize))
			))
		)),
	);
}

export function peakCacheKey(sourceId: unknown): string {
	return `${WAVEFORM_PEAK_CACHE_PREFIX}${String(sourceId)}`;
}

export function legacyPeakCacheKey(sourceId: unknown): string {
	return `audio-editor-peaks-v1:${String(sourceId)}`;
}

export function waitForAnalysisWorker(
	worker: Worker,
	expectedType: string,
	copy: WorkerCopy,
	{ signal = null, timeoutMs = 120_000 }: { readonly signal?: AbortSignal | null; readonly timeoutMs?: number } = {},
): Promise<AnalysisWorkerMessage> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => {
			globalThis.clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		};
		const resolveOnce = (value: AnalysisWorkerMessage): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		const rejectOnce = (error: unknown): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const abort = (): void => rejectOnce(signal?.reason instanceof Error ? signal.reason : abortError());
		const timeout = globalThis.setTimeout(() => rejectOnce(
			Object.assign(new Error(copy.audioAnalysisWorkerFailed), { code: 'WORKER_TIMEOUT' }),
		), timeoutMs);
		worker.onmessage = ({ data = {} }: MessageEvent<AnalysisWorkerMessage>) => {
			if (data.type === 'error') rejectOnce(new Error(data.message || copy.audioAnalysisFailed));
			else if (data.type === expectedType) resolveOnce(data);
		};
		worker.onerror = (event) => rejectOnce(event.error || new Error(event.message || copy.audioAnalysisWorkerFailed));
		worker.onmessageerror = () => rejectOnce(new Error(copy.audioAnalysisWorkerFailed));
		if (signal?.aborted) abort();
		else signal?.addEventListener('abort', abort, { once: true });
	});
}

export function mixToMono(channels: Float32Array[]): Float32Array {
	const length = channels[0]?.length || 0;
	const mono = new Float32Array(length);
	for (const channel of channels) {
		for (let index = 0; index < length; index += 1) mono[index] += channel[index]! / channels.length;
	}
	return mono;
}

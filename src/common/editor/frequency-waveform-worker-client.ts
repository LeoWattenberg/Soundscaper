/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FrequencyWaveformAnalyzer,
	type GenerateFrequencyWaveformOptions,
	generateFrequencyWaveformWindowWithFft,
	type GenerateFrequencyWaveformWindowOptions,
} from './frequency-waveform-analysis.ts';
import {
	frequencyWaveformVisualChannelCount,
	validateFrequencyWaveformAnalysis,
	validateFrequencyWaveformWindow,
	type FrequencyWaveformAnalysis,
	type FrequencyWaveformWindow,
} from './frequency-waveform-contract.ts';
import type {
	FrequencyWaveformWorkerRequest,
	FrequencyWaveformWorkerResponse,
} from './frequency-waveform-worker-protocol.ts';
import { fft, initializePffft } from './pffft.js';

export interface FrequencyWaveformSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

export interface FrequencyWaveformPcmChunk {
	readonly channels: readonly Float32Array[];
	readonly frames: number;
}

export interface FrequencyWaveformStore {
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<FrequencyWaveformPcmChunk>;
}

export interface FrequencyWaveformGenerationOptions extends GenerateFrequencyWaveformOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: (value: number) => void;
}

export interface BufferedFrequencyWaveformGenerationOptions extends FrequencyWaveformGenerationOptions {
	readonly chunkFrames?: number;
}

export interface FrequencyWaveformWindowGenerationOptions extends GenerateFrequencyWaveformWindowOptions {
	readonly signal?: AbortSignal;
}

interface FrequencyWorkerLike {
	onmessage: ((event: MessageEvent<FrequencyWaveformWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	postMessage(message: FrequencyWaveformWorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
}

export async function generateStoredFrequencyWaveformAnalysis(
	store: FrequencyWaveformStore,
	source: FrequencyWaveformSource,
	options: FrequencyWaveformGenerationOptions = {},
): Promise<FrequencyWaveformAnalysis> {
	throwIfAborted(options.signal);
	if (typeof Worker !== 'function') return generateStoredFrequencyWaveformAnalysisFallback(store, source, options);
	const worker: FrequencyWorkerLike = new Worker(
		new URL('./frequency-waveform-worker.ts', import.meta.url),
		{ type: 'module' },
	);
	const visualChannelCount = frequencyWaveformVisualChannelCount(source.channelCount);
	let framesProcessed = 0;
	try {
		const ready = waitForFrequencyWorker(worker, 'ready', options.signal);
		worker.postMessage({ type: 'start', options: {
			channelCount: source.channelCount,
			crossovers: options.crossovers,
			frameCount: source.frameCount,
			sampleRate: source.sampleRate,
		} });
		await ready;
		for await (const chunk of store.readSourceChunks(
			source.storageKey || source.id,
			{ signal: options.signal },
		)) {
			throwIfAborted(options.signal);
			validateChunk(chunk, source.channelCount);
			const channels = chunk.channels.slice(0, visualChannelCount)
				.map((channel) => channel.slice());
			const acknowledged = waitForFrequencyWorker(worker, 'ack', options.signal);
			const buffers = channels.map((channel) => channel.buffer as ArrayBuffer);
			worker.postMessage({ type: 'chunk', channels: buffers }, buffers);
			await acknowledged;
			framesProcessed += chunk.frames;
			progress(options, framesProcessed, source.frameCount);
		}
		validateProcessedFrames(framesProcessed, source.frameCount);
		const completed = waitForFrequencyWorker(worker, 'result', options.signal);
		worker.postMessage({ type: 'finish' });
		const response = await completed;
		if (response.type !== 'result') throw new Error('Frequency waveform worker returned no analysis.');
		return validateFrequencyWaveformAnalysis(response.result);
	} finally {
		worker.terminate();
	}
}

export async function generateStoredFrequencyWaveformAnalysisFallback(
	store: FrequencyWaveformStore,
	source: FrequencyWaveformSource,
	options: FrequencyWaveformGenerationOptions = {},
): Promise<FrequencyWaveformAnalysis> {
	throwIfAborted(options.signal);
	await initializePffft();
	throwIfAborted(options.signal);
	const analyzer = new FrequencyWaveformAnalyzer({
		channelCount: source.channelCount,
		crossovers: options.crossovers,
		frameCount: source.frameCount,
		sampleRate: source.sampleRate,
	}, fft);
	const visualChannelCount = frequencyWaveformVisualChannelCount(source.channelCount);
	let framesProcessed = 0;
	for await (const chunk of store.readSourceChunks(
		source.storageKey || source.id,
		{ signal: options.signal },
	)) {
		throwIfAborted(options.signal);
		validateChunk(chunk, source.channelCount);
		analyzer.push(chunk.channels.slice(0, visualChannelCount));
		framesProcessed += chunk.frames;
		progress(options, framesProcessed, source.frameCount);
		if (options.signal || options.onProgress) await yieldToEventLoop();
		throwIfAborted(options.signal);
	}
	validateProcessedFrames(framesProcessed, source.frameCount);
	throwIfAborted(options.signal);
	return analyzer.finish();
}

export async function generateFrequencyWaveformAnalysisInWorker(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: BufferedFrequencyWaveformGenerationOptions = {},
): Promise<FrequencyWaveformAnalysis> {
	const frameCount = validateBufferedChannels(channels);
	const chunkFrames = normalizeChunkFrames(options.chunkFrames);
	const store: FrequencyWaveformStore = {
		async *readSourceChunks() {
			for (let offset = 0; offset < frameCount; offset += chunkFrames) {
				const values = channels.map((channel) => channel.subarray(
					offset,
					Math.min(frameCount, offset + chunkFrames),
				));
				yield { channels: values, frames: values[0]?.length || 0 };
			}
		},
	};
	return generateStoredFrequencyWaveformAnalysis(store, {
		id: 'buffer',
		frameCount,
		channelCount: channels.length,
		sampleRate,
	}, options);
}

export async function generateFrequencyWaveformWindowInWorker(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: FrequencyWaveformWindowGenerationOptions = {},
): Promise<FrequencyWaveformWindow> {
	validateBufferedChannels(channels);
	throwIfAborted(options.signal);
	const { signal, ...requestedWindowOptions } = options;
	const sourceChannelCount = channels.length;
	const visualChannelCount = frequencyWaveformVisualChannelCount(sourceChannelCount);
	const windowOptions: GenerateFrequencyWaveformWindowOptions = {
		...requestedWindowOptions,
		sourceChannelCount,
	};
	if (typeof Worker !== 'function') {
		await initializePffft();
		throwIfAborted(signal);
		return validateFrequencyWaveformWindow(generateFrequencyWaveformWindowWithFft(
			channels,
			sampleRate,
			windowOptions,
			fft,
		));
	}
	const worker: FrequencyWorkerLike = new Worker(
		new URL('./frequency-waveform-worker.ts', import.meta.url),
		{ type: 'module' },
	);
	try {
			const copies = channels.slice(0, visualChannelCount).map((channel) => channel.slice());
		const buffers = copies.map((channel) => channel.buffer as ArrayBuffer);
		const completed = waitForFrequencyWorker(worker, 'window-result', signal);
		worker.postMessage({
			type: 'window',
			channels: buffers,
			sampleRate,
			options: windowOptions,
		}, buffers);
		const response = await completed;
		if (response.type !== 'window-result') {
			throw new Error('Frequency waveform worker returned no bounded window.');
		}
		return validateFrequencyWaveformWindow(response.result);
	} finally {
		worker.terminate();
	}
}

function waitForFrequencyWorker(
	worker: FrequencyWorkerLike,
	expectedType: FrequencyWaveformWorkerResponse['type'],
	signal?: AbortSignal,
	timeoutMs = 120_000,
): Promise<FrequencyWaveformWorkerResponse> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = (): void => {
			globalThis.clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		};
		const resolveOnce = (response: FrequencyWaveformWorkerResponse): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(response);
		};
		const rejectOnce = (error: unknown): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const abort = (): void => rejectOnce(abortError(signal));
		const timeout = globalThis.setTimeout(() => rejectOnce(
			Object.assign(new Error('Frequency waveform worker timed out.'), { code: 'WORKER_TIMEOUT' }),
		), timeoutMs);
		worker.onmessage = ({ data }) => {
			if (data.type === 'error') rejectOnce(new Error(data.message));
			else if (data.type === expectedType) resolveOnce(data);
		};
		worker.onerror = (event) => rejectOnce(event.error || new Error(event.message));
		worker.onmessageerror = () => rejectOnce(new Error('Frequency waveform worker response could not be read.'));
		if (signal?.aborted) abort();
		else signal?.addEventListener('abort', abort, { once: true });
	});
}

function validateChunk(chunk: FrequencyWaveformPcmChunk, channelCount: number): void {
	if (!Number.isSafeInteger(chunk.frames) || chunk.frames < 0
		|| chunk.channels.length !== channelCount
		|| chunk.channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== chunk.frames)) {
		throw new RangeError('Stored frequency waveform PCM chunk geometry is invalid.');
	}
}

function validateBufferedChannels(channels: readonly Float32Array[]): number {
	if (!channels.length) throw new RangeError('Frequency waveform audio must contain a channel.');
	const frameCount = channels[0]?.length || 0;
	if (channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new TypeError('Frequency waveform channels must be equally sized Float32Arrays.');
	}
	return frameCount;
}

function validateProcessedFrames(actual: number, expected: number): void {
	if (actual !== expected) throw new Error('Stored audio frame count does not match its frequency waveform metadata.');
}

function normalizeChunkFrames(value: unknown): number {
	const frames = Number(value ?? 65_536);
	if (!Number.isSafeInteger(frames) || frames < 1) throw new RangeError('Invalid frequency waveform chunk size.');
	return frames;
}

function progress(options: FrequencyWaveformGenerationOptions, frames: number, total: number): void {
	options.onProgress?.(frames / Math.max(1, total));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	return new DOMException('The operation was aborted.', 'AbortError');
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => { globalThis.setTimeout(resolve, 0); });
}

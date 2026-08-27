/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	Mp4OutputFormat,
	Output,
} from 'mediabunny';
import { browserAacMetadataTags } from './browser-aac-metadata.ts';
import {
	BROWSER_AAC_WEB_CODECS_CODEC,
	browserWebCodecsAudioConfiguration,
	probeBrowserWebCodecsAudioEncoding,
	type BrowserAudioEncoderProbe,
} from './browser-webcodecs-audio-profile.ts';

export interface BrowserAacEncodeRequest {
	readonly input: Uint8Array;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly bitrate: number;
	readonly maximumOutputBytes: number;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
}

const AUDIO_SAMPLE_FRAMES = 2_048;

export async function probeBrowserAacEncoding(
	encoder: BrowserAudioEncoderProbe | undefined = (
		globalThis as Readonly<Record<string, unknown>>
	).AudioEncoder as BrowserAudioEncoderProbe | undefined,
	geometry: Readonly<{ sampleRate: number; channelCount: number; bitrate: number }>,
): Promise<boolean> {
	return probeBrowserWebCodecsAudioEncoding('aac', geometry, encoder);
}

/** Encode interleaved Float32 PCM with WebCodecs and mux it into a complete M4A file. */
export async function encodeBrowserAacM4a(
	requestValue: BrowserAacEncodeRequest,
): Promise<Uint8Array<ArrayBuffer>> {
	const request = normalizeRequest(requestValue);
	throwIfAborted(request.signal);
	if (!await awaitWithAbort(probeBrowserAacEncoding(undefined, request), request.signal)) {
		throw new BrowserAacUnavailableError('This browser does not encode the requested AAC configuration.');
	}
	throwIfAborted(request.signal);
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new AudioSampleSource({
		codec: 'aac',
		fullCodecString: BROWSER_AAC_WEB_CODECS_CODEC,
		bitrate: request.bitrate,
	});
	output.addAudioTrack(source);
	output.setMetadataTags(browserAacMetadataTags(request.metadata));
	let cancellation: Promise<void> | null = null;
	const cancelOutput = (): Promise<void> => {
		cancellation ??= output.cancel().catch(() => undefined);
		return cancellation;
	};
	const onAbort = (): void => { void cancelOutput(); };
	request.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		throwIfAborted(request.signal);
		await awaitWithAbort(output.start(), request.signal);
		for (let frameOffset = 0; frameOffset < request.frameCount; frameOffset += AUDIO_SAMPLE_FRAMES) {
			throwIfAborted(request.signal);
			const frames = Math.min(AUDIO_SAMPLE_FRAMES, request.frameCount - frameOffset);
			const byteOffset = frameOffset * request.channelCount * Float32Array.BYTES_PER_ELEMENT;
			const byteLength = frames * request.channelCount * Float32Array.BYTES_PER_ELEMENT;
			const sample = new AudioSample({
				format: 'f32',
				sampleRate: request.sampleRate,
				numberOfChannels: request.channelCount,
				timestamp: frameOffset / request.sampleRate,
				data: request.input.slice(byteOffset, byteOffset + byteLength),
			});
			try { await awaitWithAbort(source.add(sample), request.signal); } finally { sample.close(); }
		}
		throwIfAborted(request.signal);
		await awaitWithAbort(output.finalize(), request.signal);
		throwIfAborted(request.signal);
	} catch (error) {
		await cancelOutput();
		throwIfAborted(request.signal);
		throw error;
	} finally {
		request.signal?.removeEventListener('abort', onAbort);
	}
	throwIfAborted(request.signal);
	if (!(target.buffer instanceof ArrayBuffer) || target.buffer.byteLength < 1) {
		throw new Error('The WebCodecs AAC muxer returned no M4A bytes.');
	}
	if (target.buffer.byteLength > request.maximumOutputBytes) {
		throw new RangeError('The WebCodecs AAC output exceeds its requested byte bound.');
	}
	return new Uint8Array(target.buffer);
}

export class BrowserAacUnavailableError extends Error {
	readonly code = 'BROWSER_AAC_UNAVAILABLE';

	constructor(message: string) {
		super(message);
		this.name = 'BrowserAacUnavailableError';
	}
}

export function aacConfiguration(
	geometry: Readonly<{ sampleRate: number; channelCount: number; bitrate: number }>,
): Readonly<Record<string, unknown>> {
	return browserWebCodecsAudioConfiguration('aac', geometry);
}

function normalizeRequest(request: BrowserAacEncodeRequest): BrowserAacEncodeRequest {
	if (!request || typeof request !== 'object' || !(request.input instanceof Uint8Array)) {
		throw new TypeError('WebCodecs AAC requires interleaved Float32 PCM.');
	}
	const frameCount = positiveInteger(request.frameCount, 'frame count');
	const channelCount = positiveInteger(request.channelCount, 'channel count');
	const sampleRate = positiveInteger(request.sampleRate, 'sample rate');
	const bitrate = positiveInteger(request.bitrate, 'bitrate');
	const maximumOutputBytes = positiveInteger(request.maximumOutputBytes, 'maximum output bytes');
	if (channelCount > 8) throw new RangeError('WebCodecs AAC supports at most eight channels.');
	if (request.input.byteLength !== frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT) {
		throw new RangeError('WebCodecs AAC PCM geometry is inconsistent.');
	}
	if (request.signal !== undefined && (
		typeof AbortSignal !== 'function' || !(request.signal instanceof AbortSignal)
	)) {
		throw new TypeError('WebCodecs AAC signal must be an AbortSignal.');
	}
	return Object.freeze({
		input: Uint8Array.from(request.input), frameCount, channelCount, sampleRate, bitrate,
		maximumOutputBytes,
		...(request.metadata ? { metadata: Object.freeze({ ...request.metadata }) } : {}),
		...(request.signal ? { signal: request.signal } : {}),
	});
}

function awaitWithAbort<Value>(operation: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve(operation);
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(abortReason(signal)));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		void Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('The WebCodecs AAC export was cancelled.', 'AbortError');
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`WebCodecs AAC ${label} must be a positive integer.`);
	}
	return value;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	BufferSource,
	Input,
	MP4,
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
const AAC_LC_CODEC_PROFILE = 'mp4a.40.2';

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
	const bytes = new Uint8Array(target.buffer);
	await validateBrowserAacM4aOutput(bytes, {
		frameCount: request.frameCount,
		channelCount: request.channelCount,
		sampleRate: request.sampleRate,
		...(request.signal ? { signal: request.signal } : {}),
	});
	throwIfAborted(request.signal);
	return bytes;
}

export class BrowserAacUnavailableError extends Error {
	readonly code = 'BROWSER_AAC_UNAVAILABLE';

	constructor(message: string) {
		super(message);
		this.name = 'BrowserAacUnavailableError';
	}
}

export interface BrowserAacM4aExpectation {
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly signal?: AbortSignal;
}

export interface BrowserAacM4aValidation {
	readonly codec: 'aac';
	readonly codecProfile: typeof AAC_LC_CODEC_PROFILE;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly durationSeconds: number;
}

export class BrowserAacM4aValidationError extends Error {
	readonly code = 'BROWSER_AAC_M4A_VALIDATION_FAILED';

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'BrowserAacM4aValidationError';
	}
}

/** Demux and bind the completed file to the exact PCM geometry that produced it. */
export async function validateBrowserAacM4aOutput(
	bytes: Uint8Array,
	expectationValue: BrowserAacM4aExpectation,
): Promise<BrowserAacM4aValidation> {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
		throw new BrowserAacM4aValidationError('Browser AAC output must contain M4A bytes.');
	}
	const expectation = normalizeValidationExpectation(expectationValue);
	throwIfAborted(expectation.signal);
	const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
	const onAbort = (): void => input.dispose();
	expectation.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const [format, readable, tracks, audioTracks, videoTracks] = await Promise.all([
			input.getFormat(), input.canRead(), input.getTracks(),
			input.getAudioTracks(), input.getVideoTracks(),
		]);
		throwIfAborted(expectation.signal);
		if (format !== MP4 || !readable) {
			throw new BrowserAacM4aValidationError('Browser AAC output is not a readable MP4 file.');
		}
		if (tracks.length !== 1 || audioTracks.length !== 1 || videoTracks.length !== 0) {
			throw new BrowserAacM4aValidationError(
				'Browser AAC output must contain exactly one audio track and no other tracks.',
			);
		}
		const audio = audioTracks[0]!;
		const [codec, codecProfile, decoderConfig, sampleRate, channelCount, durationSeconds] = await Promise.all([
			audio.getCodec(), audio.getCodecParameterString(), audio.getDecoderConfig(),
			audio.getSampleRate(), audio.getNumberOfChannels(), input.computeDuration([audio]),
		]);
		throwIfAborted(expectation.signal);
		if (codec !== 'aac' || codecProfile !== AAC_LC_CODEC_PROFILE
			|| decoderConfig?.codec !== AAC_LC_CODEC_PROFILE
			|| decoderConfig.description === undefined || decoderConfig.description.byteLength < 1) {
			throw new BrowserAacM4aValidationError(
				`Browser AAC output must contain AAC-LC profile ${AAC_LC_CODEC_PROFILE}.`,
			);
		}
		if (sampleRate !== expectation.sampleRate || decoderConfig.sampleRate !== expectation.sampleRate) {
			throw new BrowserAacM4aValidationError(
				'Browser AAC output sample rate does not match the requested PCM sample rate.',
			);
		}
		if (channelCount !== expectation.channelCount
			|| decoderConfig.numberOfChannels !== expectation.channelCount) {
			throw new BrowserAacM4aValidationError(
				'Browser AAC output channel count does not match the requested PCM channel count.',
			);
		}
		const requestedDuration = expectation.frameCount / expectation.sampleRate;
		const durationTolerance = Math.max(1 / expectation.sampleRate, Number.EPSILON);
		if (!Number.isFinite(durationSeconds) || durationSeconds <= 0
			|| Math.abs(durationSeconds - requestedDuration) > durationTolerance) {
			throw new BrowserAacM4aValidationError(
				'Browser AAC output duration does not match the requested PCM duration.',
			);
		}
		return Object.freeze({
			codec: 'aac' as const,
			codecProfile: AAC_LC_CODEC_PROFILE,
			sampleRate,
			channelCount,
			durationSeconds,
		});
	} catch (error) {
		throwIfAborted(expectation.signal);
		if (error instanceof BrowserAacM4aValidationError) throw error;
		throw new BrowserAacM4aValidationError(
			'Browser AAC output could not be demuxed as a complete M4A file.',
			{ cause: error },
		);
	} finally {
		expectation.signal?.removeEventListener('abort', onAbort);
		input.dispose();
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

function normalizeValidationExpectation(
	value: BrowserAacM4aExpectation,
): BrowserAacM4aExpectation {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Browser AAC validation requires an expected PCM geometry.');
	}
	const frameCount = positiveInteger(value.frameCount, 'validation frame count');
	const sampleRate = positiveInteger(value.sampleRate, 'validation sample rate');
	const channelCount = positiveInteger(value.channelCount, 'validation channel count');
	if (value.signal !== undefined && (
		typeof AbortSignal !== 'function' || !(value.signal instanceof AbortSignal)
	)) throw new TypeError('Browser AAC validation signal must be an AbortSignal.');
	return Object.freeze({
		frameCount,
		sampleRate,
		channelCount,
		...(value.signal ? { signal: value.signal } : {}),
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

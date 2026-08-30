/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded browser-native decode of the primary audio track in a video container. */

import {
	VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS,
	VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE,
} from './video-source-characteristics.ts';
import { throwIfAborted } from './video-timing-demux-reader.ts';

const DEFAULT_MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;
const MAXIMUM_AUDIO_CHANNELS = 32;
const MAXIMUM_SAMPLE_FRAMES = 65_536;
const MAXIMUM_TIMESTAMP_JITTER_SECONDS = 0.001;

export interface BrowserContainerAudioSample {
	readonly timestamp: number;
	readonly sampleRate: number;
	readonly numberOfFrames: number;
	readonly numberOfChannels: number;
	readonly duration: number;
	copyTo(destination: Float32Array, options: Readonly<{
		planeIndex: number;
		format: 'f32-planar';
		frameOffset?: number;
		frameCount?: number;
	}>): void;
	close(): void;
}

export interface BrowserContainerAudioDecodeSession {
	readonly timelineOrigin: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	samples(endTimestamp?: number): AsyncIterable<BrowserContainerAudioSample>;
	dispose(): void;
}

export interface BrowserContainerAudioDecodeOptions {
	readonly signal?: AbortSignal;
	readonly durationSeconds: number;
	readonly maximumOutputBytes?: number;
	readonly openSession?: (
		blob: Blob,
		signal?: AbortSignal,
	) => Promise<BrowserContainerAudioDecodeSession>;
}

export interface BrowserContainerAudioDecodeResult {
	readonly channels: readonly Float32Array[];
	readonly sampleRate: number;
	readonly frameCount: number;
}

/** Decode and place PCM at its container timestamps, retaining real leading gaps. */
export async function decodeBrowserContainerAudio(
	blob: Blob,
	options: BrowserContainerAudioDecodeOptions,
): Promise<BrowserContainerAudioDecodeResult> {
	if (!(blob instanceof Blob)) throw new TypeError('A video Blob is required for container audio decode.');
	const maximumOutputBytes = outputBound(options.maximumOutputBytes);
	throwIfAborted(options.signal);
	const session = await (options.openSession ?? openMediabunnySession)(blob, options.signal);
	const onAbort = (): void => session.dispose();
	options.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		throwIfAborted(options.signal);
		if (!Number.isFinite(session.timelineOrigin)) {
			throw new TypeError('The container audio timeline origin is invalid.');
		}
		validateSession(session);
		const durationSeconds = positiveDuration(options.durationSeconds);
		const targetFrameCount = Math.ceil(durationSeconds * session.sampleRate);
		const byteLength = targetFrameCount * session.channelCount * Float32Array.BYTES_PER_ELEMENT;
		if (!Number.isSafeInteger(targetFrameCount) || targetFrameCount < 1
			|| !Number.isSafeInteger(byteLength) || byteLength > maximumOutputBytes) {
			throw new RangeError('The decoded container audio exceeds its output bound.');
		}
		const channels = Array.from(
			{ length: session.channelCount },
			() => new Float32Array(targetFrameCount),
		);
		let previousEndFrame = 0;
		let copiedFrames = 0;
		for await (const sample of session.samples(session.timelineOrigin + durationSeconds)) {
			try {
				throwIfAborted(options.signal);
				validateSample(sample, session.sampleRate, session.channelCount);
				const rawStartFrame = Math.round(
					(sample.timestamp - session.timelineOrigin) * session.sampleRate,
				);
				if (!Number.isSafeInteger(rawStartFrame)) {
					throw new RangeError('The container audio timestamp is outside the safe frame range.');
				}
				let frameOffset = Math.max(0, -rawStartFrame);
				let startFrame = Math.max(0, rawStartFrame);
				const overlapFrames = Math.max(0, previousEndFrame - startFrame);
				if (overlapFrames > Math.ceil(session.sampleRate * MAXIMUM_TIMESTAMP_JITTER_SECONDS)) {
					throw new RangeError('The container audio samples overlap or exceed the safe timeline.');
				}
				frameOffset += overlapFrames;
				startFrame += overlapFrames;
				const frameCount = Math.min(
					sample.numberOfFrames - frameOffset,
					targetFrameCount - startFrame,
				);
				if (frameCount <= 0) continue;
				const nextEndFrame = startFrame + frameCount;
				if (!Number.isSafeInteger(nextEndFrame)) {
					throw new RangeError('The container audio samples overlap or exceed the safe timeline.');
				}
				for (let planeIndex = 0; planeIndex < session.channelCount; planeIndex += 1) {
					sample.copyTo(channels[planeIndex]!.subarray(startFrame, nextEndFrame), {
						planeIndex, format: 'f32-planar', frameOffset, frameCount,
					});
					throwIfAborted(options.signal);
				}
				copiedFrames += frameCount;
				previousEndFrame = nextEndFrame;
			} finally {
				sample.close();
			}
		}
		throwIfAborted(options.signal);
		if (copiedFrames === 0) {
			throw new Error('The video container has no decodable primary audio samples.');
		}
		return Object.freeze({
			channels: Object.freeze(channels),
			sampleRate: session.sampleRate,
			frameCount: targetFrameCount,
		});
	} catch (error) {
		throwIfAborted(options.signal);
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', onAbort);
		session.dispose();
	}
}

function validateSample(sample: BrowserContainerAudioSample, sampleRate: number, channelCount: number): void {
	if (!Number.isSafeInteger(sample.sampleRate) || sample.sampleRate < 1
		|| sample.sampleRate > VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE) {
		throw new RangeError('The decoded container audio sample rate is unsupported.');
	}
	if (!Number.isSafeInteger(sample.numberOfChannels) || sample.numberOfChannels < 1
		|| sample.numberOfChannels > MAXIMUM_AUDIO_CHANNELS) {
		throw new RangeError('The decoded container audio channel count is unsupported.');
	}
	if (!Number.isSafeInteger(sample.numberOfFrames) || sample.numberOfFrames < 1
		|| sample.numberOfFrames > MAXIMUM_SAMPLE_FRAMES || !Number.isFinite(sample.timestamp)
		|| !Number.isFinite(sample.duration) || sample.duration <= 0) {
		throw new RangeError('The decoded container audio sample geometry is invalid.');
	}
	if (sample.sampleRate !== sampleRate) {
		throw new RangeError('The container audio sample rate changes within one track.');
	}
	if (sample.numberOfChannels !== channelCount) {
		throw new RangeError('The container audio channel count changes within one track.');
	}
}

async function openMediabunnySession(
	blob: Blob,
	signal?: AbortSignal,
): Promise<BrowserContainerAudioDecodeSession> {
	throwIfAborted(signal);
	const { AudioSampleSink, BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
	throwIfAborted(signal);
	const input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, MATROSKA, WEBM] });
	const onAbort = (): void => input.dispose();
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const [track, videoTrack] = await Promise.all([
			input.getPrimaryAudioTrack(),
			input.getPrimaryVideoTrack(),
		]);
		throwIfAborted(signal);
		if (!track || !await track.canDecode()) {
			throw new Error('The video container has no browser-decodable primary audio track.');
		}
		const [timelineOrigin, sampleRate, channelCount] = await Promise.all([
			input.getFirstTimestamp([videoTrack ?? track]),
			track.getSampleRate(),
			track.getNumberOfChannels(),
		]);
		throwIfAborted(signal);
		const sink = new AudioSampleSink(track);
		return Object.freeze({
			timelineOrigin, sampleRate, channelCount,
			samples: (endTimestamp?: number) => sink.samples(undefined, endTimestamp),
			dispose: () => input.dispose(),
		});
	} catch (error) {
		input.dispose();
		throwIfAborted(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

function validateSession(session: BrowserContainerAudioDecodeSession): void {
	if (!Number.isSafeInteger(session.sampleRate) || session.sampleRate < 1
		|| session.sampleRate > VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE) {
		throw new RangeError('The container audio sample rate is unsupported.');
	}
	if (!Number.isSafeInteger(session.channelCount) || session.channelCount < 1
		|| session.channelCount > Math.min(MAXIMUM_AUDIO_CHANNELS, VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS)) {
		throw new RangeError('The container audio channel count is unsupported.');
	}
}

function positiveDuration(value: number): number {
	if (!Number.isFinite(value) || Number(value) <= 0) {
		throw new RangeError('The browser container audio duration must be positive.');
	}
	return Number(value);
}

function outputBound(value: number | undefined): number {
	const result = value ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
	if (!Number.isSafeInteger(result) || result < 1 || result > DEFAULT_MAXIMUM_OUTPUT_BYTES) {
		throw new RangeError('The browser container audio output bound must be between 1 byte and 128 MiB.');
	}
	return result;
}

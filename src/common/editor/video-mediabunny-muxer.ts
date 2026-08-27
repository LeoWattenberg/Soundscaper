/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AudioSample,
	AudioSampleSource,
	BufferTarget,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	Quality,
	WebMOutputFormat,
} from 'mediabunny';
import {
	frameTimestamp,
	type VideoWebCodecsEncodedChunk,
} from './video-webcodecs-producer.ts';
import { browserWebCodecsAudioFullCodecString } from './browser-webcodecs-audio-profile.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export type VideoMediabunnyFormat = 'mp4' | 'webm';
export type VideoMediabunnyVideoCodec = 'h264' | 'vp9';
export type VideoMediabunnyAudioCodec = 'aac' | 'opus';

export interface VideoMediabunnyMuxRequest {
	readonly format: VideoMediabunnyFormat;
	readonly videoCodec: VideoMediabunnyVideoCodec;
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly frameCount: number;
	readonly audio?: Readonly<{
		readonly codec: VideoMediabunnyAudioCodec;
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly bitrate: number;
	}>;
}

export interface VideoMediabunnyPcmChunk {
	readonly data: Uint8Array<ArrayBuffer>;
	readonly frameCount: number;
	readonly timestamp: number;
}

export interface VideoMediabunnyMuxResult {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly videoChunkCount: number;
	readonly videoByteLength: number;
	readonly audioChunkCount: number;
	readonly audioFrameCount: number;
	readonly decoderConfigObserved: boolean;
}

interface SessionVideoPacket {
	readonly data: Uint8Array<ArrayBuffer>;
	readonly type: 'key' | 'delta';
	readonly timestamp: number;
	readonly duration: number;
	readonly sequenceNumber: number;
}

interface VideoMediabunnySession {
	start(): Awaitable<void>;
	addVideo(packet: SessionVideoPacket, metadata?: EncodedVideoChunkMetadata): Awaitable<void>;
	addAudio?(chunk: VideoMediabunnyPcmChunk): Awaitable<void>;
	closeVideo(): void;
	closeAudio?(): void;
	finalize(): Awaitable<ArrayBuffer>;
	cancel(): Awaitable<void>;
}

export interface VideoMediabunnyMuxerDependencies {
	createSession(request: VideoMediabunnyMuxRequest): VideoMediabunnySession;
}

export interface VideoMediabunnyMuxer {
	start(): Promise<void>;
	addVideoChunk(
		chunk: VideoWebCodecsEncodedChunk,
		metadata?: EncodedVideoChunkMetadata,
	): Promise<void>;
	addAudioPcm(chunk: VideoMediabunnyPcmChunk): Promise<void>;
	finalize(): Promise<VideoMediabunnyMuxResult>;
	cancel(): Promise<void>;
}

const DEFAULT_DEPENDENCIES: VideoMediabunnyMuxerDependencies = Object.freeze({
	createSession: createMediabunnySession,
});

/** Own one complete MP4/WebM output and retain every WebCodecs decoder-config callback. */
export function createVideoMediabunnyMuxer(
	requestValue: VideoMediabunnyMuxRequest,
	dependencies: VideoMediabunnyMuxerDependencies = DEFAULT_DEPENDENCIES,
): VideoMediabunnyMuxer {
	const request = normalizeRequest(requestValue);
	if (!dependencies || typeof dependencies.createSession !== 'function') {
		throw new TypeError('Video Mediabunny muxer dependencies require createSession.');
	}
	const session = dependencies.createSession(request);
	let state: 'pending' | 'started' | 'finalized' | 'canceled' = 'pending';
	let videoChunkCount = 0;
	let videoByteLength = 0;
	let audioChunkCount = 0;
	let audioFrameCount = 0;
	let decoderConfigObserved = false;

	return Object.freeze({
		async start(): Promise<void> {
			if (state !== 'pending') throw new Error('Video Mediabunny muxer can only start once.');
			await session.start();
			state = 'started';
		},
		async addVideoChunk(
			chunk: VideoWebCodecsEncodedChunk,
			metadata?: EncodedVideoChunkMetadata,
		): Promise<void> {
			assertStarted(state);
			const packet = videoPacket(chunk, videoChunkCount, request.frameRate);
			const decoderConfig = metadata?.decoderConfig;
			if (decoderConfig !== undefined) decoderConfigObserved = true;
			if (videoChunkCount === 0) {
				if (packet.type !== 'key') throw new Error('The first muxed video chunk must be a key frame.');
				if (request.videoCodec === 'h264' && decoderConfig?.description === undefined) {
					throw new Error('MP4 H.264 muxing requires the first WebCodecs decoder configuration.');
				}
			}
			await session.addVideo(packet, metadata);
			videoChunkCount += 1;
			videoByteLength += packet.data.byteLength;
		},
		async addAudioPcm(chunkValue: VideoMediabunnyPcmChunk): Promise<void> {
			assertStarted(state);
			if (!request.audio || typeof session.addAudio !== 'function') {
				throw new Error('This video output has no audio track.');
			}
			const chunk = normalizePcmChunk(chunkValue, request.audio, audioFrameCount);
			await session.addAudio(chunk);
			audioChunkCount += 1;
			audioFrameCount += chunk.frameCount;
		},
		async finalize(): Promise<VideoMediabunnyMuxResult> {
			assertStarted(state);
			if (videoChunkCount !== request.frameCount) {
				throw new Error('Video Mediabunny muxing did not receive the admitted frame count.');
			}
			session.closeVideo();
			if (request.audio) session.closeAudio?.();
			const buffer = await session.finalize();
			state = 'finalized';
			if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1) {
				throw new Error('Video Mediabunny muxing returned no complete container bytes.');
			}
			return Object.freeze({
				bytes: new Uint8Array(buffer),
				videoChunkCount,
				videoByteLength,
				audioChunkCount,
				audioFrameCount,
				decoderConfigObserved,
			});
		},
		async cancel(): Promise<void> {
			if (state === 'canceled' || state === 'finalized') return;
			state = 'canceled';
			await session.cancel();
		},
	});
}

function createMediabunnySession(request: VideoMediabunnyMuxRequest): VideoMediabunnySession {
	const target = new BufferTarget();
	const format = request.format === 'mp4'
		? new Mp4OutputFormat({ fastStart: 'in-memory' })
		: new WebMOutputFormat();
	const output = new Output({ format, target });
	const videoSource = new EncodedVideoPacketSource(request.videoCodec === 'h264' ? 'avc' : 'vp9');
	output.addVideoTrack(videoSource, {
		frameRate: request.frameRate.num / request.frameRate.den,
		maximumPacketCount: request.frameCount,
	});
	const audioSource = request.audio
		? new AudioSampleSource({
			codec: request.audio.codec,
			fullCodecString: browserWebCodecsAudioFullCodecString(request.audio.codec),
			quality: new Quality({ bitrate: request.audio.bitrate }),
		})
		: null;
	if (audioSource) output.addAudioTrack(audioSource);
	return Object.freeze({
		start: () => output.start(),
		addVideo(packet: SessionVideoPacket, metadata?: EncodedVideoChunkMetadata) {
			return videoSource.add(new EncodedPacket(
				packet.data,
				packet.type,
				packet.timestamp,
				packet.duration,
				packet.sequenceNumber,
			), metadata);
		},
		...(audioSource && request.audio ? {
			async addAudio(chunk: VideoMediabunnyPcmChunk) {
				const sample = new AudioSample({
					format: 'f32',
					sampleRate: request.audio!.sampleRate,
					numberOfChannels: request.audio!.channelCount,
					timestamp: chunk.timestamp,
					data: chunk.data,
				});
				try { await audioSource.add(sample); } finally { sample.close(); }
			},
			closeAudio: () => audioSource.close(),
		} : {}),
		closeVideo: () => videoSource.close(),
		async finalize() {
			await output.finalize();
			if (!(target.buffer instanceof ArrayBuffer)) {
				throw new Error('Mediabunny finalized without a buffer target.');
			}
			return target.buffer;
		},
		cancel: () => output.cancel(),
	});
}

function normalizeRequest(value: VideoMediabunnyMuxRequest): VideoMediabunnyMuxRequest {
	if (!value || typeof value !== 'object') throw new TypeError('Video Mediabunny mux request is required.');
	const format = value.format;
	const videoCodec = value.videoCodec;
	if (format !== 'mp4' && format !== 'webm') throw new RangeError('Video mux format must be mp4 or webm.');
	if (videoCodec !== (format === 'mp4' ? 'h264' : 'vp9')) {
		throw new RangeError('MP4 requires H.264 and WebM requires VP9 in the browser-native profile.');
	}
	const frameRate = Object.freeze({
		num: positiveInteger(value.frameRate?.num, 'frame-rate numerator'),
		den: positiveInteger(value.frameRate?.den, 'frame-rate denominator'),
	});
	const audio = value.audio === undefined ? undefined : Object.freeze({
		codec: value.audio.codec,
		sampleRate: positiveInteger(value.audio.sampleRate, 'audio sample rate'),
		channelCount: positiveInteger(value.audio.channelCount, 'audio channel count'),
		bitrate: positiveInteger(value.audio.bitrate, 'audio bitrate'),
	});
	if (audio && audio.codec !== (format === 'mp4' ? 'aac' : 'opus')) {
		throw new RangeError('MP4 requires AAC and WebM requires Opus in the browser-native profile.');
	}
	return Object.freeze({
		format,
		videoCodec,
		width: positiveInteger(value.width, 'width'),
		height: positiveInteger(value.height, 'height'),
		frameRate,
		frameCount: positiveInteger(value.frameCount, 'frame count'),
		...(audio ? { audio } : {}),
	});
}

function videoPacket(
	chunk: VideoWebCodecsEncodedChunk,
	sequenceNumber: number,
	frameRate: VideoMediabunnyMuxRequest['frameRate'],
): SessionVideoPacket {
	if (!chunk || typeof chunk !== 'object' || !Number.isSafeInteger(chunk.byteLength)
		|| chunk.byteLength < 1 || typeof chunk.copyTo !== 'function') {
		throw new TypeError('Mediabunny requires a non-empty WebCodecs video chunk.');
	}
	if (chunk.type !== 'key' && chunk.type !== 'delta') {
		throw new TypeError('WebCodecs video chunk type must be key or delta.');
	}
	const duration = chunk.duration
		?? frameTimestamp(sequenceNumber + 1, frameRate) - frameTimestamp(sequenceNumber, frameRate);
	if (!Number.isSafeInteger(chunk.timestamp) || chunk.timestamp < 0
		|| !Number.isSafeInteger(duration) || duration < 1) {
		throw new RangeError('WebCodecs video chunk timing must be positive integer microseconds.');
	}
	const data = new Uint8Array(chunk.byteLength);
	chunk.copyTo(data);
	return Object.freeze({
		data,
		type: chunk.type,
		timestamp: chunk.timestamp / 1_000_000,
		duration: duration / 1_000_000,
		sequenceNumber,
	});
}

function normalizePcmChunk(
	value: VideoMediabunnyPcmChunk,
	audio: NonNullable<VideoMediabunnyMuxRequest['audio']>,
	frameOffset: number,
): VideoMediabunnyPcmChunk {
	const frameCount = positiveInteger(value?.frameCount, 'PCM frame count');
	if (!(value?.data instanceof Uint8Array)
		|| value.data.byteLength !== frameCount * audio.channelCount * Float32Array.BYTES_PER_ELEMENT) {
		throw new RangeError('Mediabunny PCM chunk bytes do not match their audio geometry.');
	}
	const timestamp = frameOffset / audio.sampleRate;
	if (value.timestamp !== timestamp) throw new RangeError('Mediabunny PCM chunks must be gapless and ordered.');
	return Object.freeze({ data: Uint8Array.from(value.data), frameCount, timestamp });
}

function assertStarted(state: string): void {
	if (state !== 'started') throw new Error('Video Mediabunny muxer is not accepting media.');
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Video Mediabunny ${label} must be a positive integer.`);
	}
	return value;
}

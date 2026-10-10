/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../wav.js';
import { inspectDecodedAudioSampleRate } from '../../audio-file-metadata.js';

const MAXIMUM_UPLOAD_BYTES = 100_000_000;
type DecodedAudio = Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>;

interface DecodeContext {
	decodeAudioData(value: ArrayBuffer): Promise<AudioBuffer>;
	close(): Promise<void>;
}

export interface FreesoundUploadFilePreparationRuntime {
	readonly createDecodeContext?: (options: AudioContextOptions) => DecodeContext;
	readonly encode?: typeof encodeWav;
	readonly maximumBytes?: number;
}

/** Convert browser-decodable audio that Freesound cannot ingest directly into 24-bit PCM WAV. */
export async function prepareFreesoundUploadFile(
	file: File,
	signal?: AbortSignal,
	runtime: FreesoundUploadFilePreparationRuntime = {},
): Promise<File> {
	signal?.throwIfAborted();
	const maximumBytes = runtime.maximumBytes ?? MAXIMUM_UPLOAD_BYTES;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('The Freesound upload byte limit is invalid.');
	}
	if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > maximumBytes) {
		throw new RangeError('The input audio exceeds the 100 MB Freesound upload limit.');
	}
	const inputBytes = await file.arrayBuffer();
	signal?.throwIfAborted();
	const sampleRate = inspectDecodedAudioSampleRate(inputBytes);
	const options: AudioContextOptions = { latencyHint: 'playback', ...(sampleRate ? { sampleRate } : {}) };
	const context = runtime.createDecodeContext?.(options) ?? createBrowserDecodeContext(options);
	let decoded: DecodedAudio;
	try { decoded = await context.decodeAudioData(inputBytes); }
	finally { await context.close(); }
	signal?.throwIfAborted();
	if (decoded.length === 0) {
		decoded = await recoverPcmWav(file, signal, maximumBytes);
	}
	signal?.throwIfAborted();
	assertConvertedExtent(decoded.length, decoded.numberOfChannels, maximumBytes);
	const channels = Array.from(
		{ length: decoded.numberOfChannels },
		(_, channel) => decoded.getChannelData(channel),
	);
	const bytes = (runtime.encode ?? encodeWav)(channels, {
		sampleRate: decoded.sampleRate,
		bitDepth: 24,
		float: false,
		dither: 'triangular',
	});
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
	signal?.throwIfAborted();
	return new File([Uint8Array.from(bytes).buffer], `${fileStem(file.name)}.wav`, {
		type: 'audio/wav',
		lastModified: file.lastModified,
	});
}

async function recoverPcmWav(file: File, signal: AbortSignal | undefined, maximumBytes: number): Promise<DecodedAudio> {
	// Some native decoders resolve an empty buffer for valid PCM WAV. Reuse the
	// application's validated source decoder instead of publishing an empty RIFF.
	const { inspectWavBlobPcm, streamWavBlobPcm } = await import('../../wav-import.js');
	const descriptor = await inspectWavBlobPcm(file, { signal }).catch((cause: unknown) => {
		signal?.throwIfAborted();
		throw new Error('This audio file could not be decoded into PCM frames.', { cause });
	});
	assertConvertedExtent(descriptor.frameCount, descriptor.channelCount, maximumBytes);
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount));
	await streamWavBlobPcm(file, {
		descriptor, signal,
		onChunk: (packet: readonly Float32Array[], info: { frameOffset: number }) => {
			packet.forEach((channel, index) => channels[index].set(channel, info.frameOffset));
		},
	});
	return {
		length: descriptor.frameCount, sampleRate: descriptor.sampleRate, numberOfChannels: descriptor.channelCount,
		getChannelData: index => channels[index],
	};
}

function assertConvertedExtent(frames: number, channelCount: number, maximumBytes: number): void {
	const expectedBytes = frames * channelCount * 3 + 4_096;
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maximumBytes) {
		throw new RangeError('The converted audio exceeds the 100 MB Freesound upload limit.');
	}
}

function createBrowserDecodeContext(options: AudioContextOptions): DecodeContext {
	const scope = globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};
	const Context = scope.AudioContext ?? scope.webkitAudioContext;
	if (!Context) throw new Error('This audio format cannot be decoded in this browser.');
	return new Context(options);
}

function fileStem(value: string): string {
	const stem = value.replace(/\\/gu, '/').split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? '';
	const safeStem = Array.from(stem, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127 || '/:*?"<>|'.includes(character) ? '-' : character;
	}).join('');
	return safeStem.replace(/^\.+/u, '').trim().slice(0, 220)
		|| 'soundscaper-audio';
}

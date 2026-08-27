/* SPDX-License-Identifier: AGPL-3.0-only */

/** Operation-owned, bounded-chunk PCM conformance for local inference adapters. */

import { createStreamingWindowedSincResampler } from '../resample.js';
import { createWavStreamEncoder } from '../wav.js';
import {
	localAssistanceAudioWaveGeometry,
	localAssistanceAudioInputProfile,
	type ProfiledAudioOperation,
} from './local-assistance-audio-geometry.ts';
import { bindLocalAssistancePreparedAudioWaveRelease } from
	'./local-assistance-audio-spool-release.ts';

export { releaseLocalAssistancePreparedAudioWave } from
	'./local-assistance-audio-spool-release.ts';

export {
	localAssistanceAudioInputProfile,
	type LocalAssistanceAudioInputProfile,
} from './local-assistance-audio-geometry.ts';

export const LOCAL_ASSISTANCE_PREPARATION_CHUNK_FRAMES = 65_536;
export const LOCAL_ASSISTANCE_PREPARATION_IN_MEMORY_BYTES = 32 * 1024 * 1024;

const AUDIO_WAVE_MEDIA_TYPE = 'audio/wav';
const MAXIMUM_ENCODED_CHUNK_BYTES = 16 * 1024 * 1024;

export interface LocalAssistanceAudioWaveSpoolV1 {
	write(chunk: Uint8Array): Promise<void>;
	close(mediaType: typeof AUDIO_WAVE_MEDIA_TYPE): Promise<Readonly<{
		body: Blob;
		release(): Promise<void>;
	}>>;
	abort(): Promise<void>;
}

export interface LocalAssistanceAudioWavePreparationOptionsV1 {
	readonly maximumInMemoryByteLength?: number;
	readonly openSpool?: (
		expectedByteLength: number,
		mediaType: typeof AUDIO_WAVE_MEDIA_TYPE,
	) => Promise<LocalAssistanceAudioWaveSpoolV1>;
}

export async function createLocalAssistanceAudioWave(
	operation: ProfiledAudioOperation,
	channelsValue: readonly Float32Array[],
	expectedFrames: number,
	inputSampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	assertChunkGeometry(channelsValue, expectedFrames, channelsValue.length);
	async function* chunks(): AsyncGenerator<readonly Float32Array[]> {
		yield channelsValue;
	}
	return createLocalAssistanceAudioWaveFromChunks(
		operation, chunks(), expectedFrames, inputSampleRate, channelsValue.length, signal,
	);
}

/**
 * Conform a whole fenced selection while retaining one rendered and one encoded chunk.
 * Small bodies have an explicit memory ceiling; larger bodies use a capacity-checked
 * disposable OPFS file that remains streamable to desktop custody.
 */
export async function createLocalAssistanceAudioWaveFromChunks(
	operation: ProfiledAudioOperation,
	inputChunks: AsyncIterable<readonly Float32Array[]>,
	expectedFrames: number,
	inputSampleRate: number,
	inputChannelCount: number,
	signal?: AbortSignal,
	options: LocalAssistanceAudioWavePreparationOptionsV1 = {},
): Promise<Blob> {
	if (!inputChunks || typeof inputChunks[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Assistance audio preparation requires a bounded chunk stream.');
	}
	const geometry = localAssistanceAudioWaveGeometry(
		operation, expectedFrames, inputSampleRate, inputChannelCount,
	);
	const selected = localAssistanceAudioInputProfile(operation);
	const spool = await openAudioWaveSpool(geometry.byteLength, options);
	let writeChain = Promise.resolve();
	const encoder = createWavStreamEncoder({
		sampleRate: geometry.sampleRate,
		channelCount: geometry.channelCount,
		totalFrames: geometry.frameCount,
		bitDepth: 32,
		float: true,
		dither: false,
		collect: false,
		onChunk: (chunk: Uint8Array) => {
			writeChain = writeChain.then(() => spool.write(chunk));
			return writeChain;
		},
	});
	const resampler = inputSampleRate === geometry.sampleRate ? null
		: createStreamingWindowedSincResampler(
			inputSampleRate, geometry.sampleRate, geometry.channelCount,
		) as unknown as Readonly<{
			push(channels: Float32Array[]): Float32Array[];
			finish(outputFrames: number): Float32Array[];
		}>;
	try {
		let receivedFrames = 0;
		for await (const chunk of inputChunks) {
			signal?.throwIfAborted();
			const frameCount = chunk[0]?.length ?? 0;
			assertChunkGeometry(chunk, frameCount, inputChannelCount);
			if (frameCount < 1 || receivedFrames + frameCount > expectedFrames) {
				throw new Error('The selected audio chunk stream exceeded its exact geometry.');
			}
			receivedFrames += frameCount;
			const conformed = selected.channels === 'mono' ? [downmixChunk(chunk)] : [...chunk];
			const output = resampler ? resampler.push(conformed) : conformed;
			if ((output[0]?.length ?? 0) > 0) encoder.write(output);
			await encoder.settled();
			await yieldForCancellation(signal);
		}
		if (receivedFrames !== expectedFrames) {
			throw new Error('The selected audio chunk stream returned inexact geometry.');
		}
		if (resampler) {
			const tail = resampler.finish(geometry.frameCount);
			if ((tail[0]?.length ?? 0) > 0) encoder.write(tail);
		}
		signal?.throwIfAborted();
		const finalized = encoder.finalize() as Readonly<{ byteLength: number; frames: number }>;
		await encoder.settled();
		signal?.throwIfAborted();
		if (finalized.byteLength !== geometry.byteLength || finalized.frames !== geometry.frameCount) {
			throw new Error('The selected audio encoder returned inexact geometry.');
		}
		const completed = await spool.close(AUDIO_WAVE_MEDIA_TYPE);
		if (!completed || !(completed.body instanceof Blob)
			|| completed.body.size !== geometry.byteLength
			|| completed.body.type !== AUDIO_WAVE_MEDIA_TYPE
			|| typeof completed.release !== 'function') {
			throw new Error('The selected audio spool returned inexact Blob geometry.');
		}
		bindLocalAssistancePreparedAudioWaveRelease(completed.body, completed.release);
		return completed.body;
	} catch (error) {
		await spool.abort().catch(() => undefined);
		throw error;
	}
}

async function openAudioWaveSpool(
	expectedByteLength: number,
	options: LocalAssistanceAudioWavePreparationOptionsV1,
): Promise<LocalAssistanceAudioWaveSpoolV1> {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Assistance audio preparation options are invalid.');
	}
	const maximumInMemory = options.maximumInMemoryByteLength
		?? LOCAL_ASSISTANCE_PREPARATION_IN_MEMORY_BYTES;
	if (!Number.isSafeInteger(maximumInMemory) || maximumInMemory < 1
		|| maximumInMemory > LOCAL_ASSISTANCE_PREPARATION_IN_MEMORY_BYTES
		|| options.openSpool !== undefined && typeof options.openSpool !== 'function') {
		throw new RangeError('Assistance audio preparation capacity options are invalid.');
	}
	const spool = expectedByteLength <= maximumInMemory
		? memorySpool(expectedByteLength)
		: await (options.openSpool ?? openOpfsSpool)(expectedByteLength, AUDIO_WAVE_MEDIA_TYPE);
	if (!spool || typeof spool !== 'object' || typeof spool.write !== 'function'
		|| typeof spool.close !== 'function' || typeof spool.abort !== 'function') {
		throw new TypeError('Assistance audio preparation requires an exact disposable spool.');
	}
	return spool;
}

function memorySpool(expectedByteLength: number): LocalAssistanceAudioWaveSpoolV1 {
	const parts: ArrayBuffer[] = [];
	let written = 0;
	let settled = false;
	return Object.freeze({
		async write(chunk: Uint8Array) {
			assertSpoolChunk(chunk, written, expectedByteLength, settled);
			parts.push(chunk.slice().buffer as ArrayBuffer);
			written += chunk.byteLength;
		},
		async close(mediaType: typeof AUDIO_WAVE_MEDIA_TYPE) {
			if (settled || written !== expectedByteLength) {
				throw new Error('The in-memory assistance audio spool has inexact geometry.');
			}
			settled = true;
			return Object.freeze({ body: new Blob(parts, { type: mediaType }),
				release: async () => undefined });
		},
		async abort() { settled = true; parts.length = 0; },
	});
}

async function openOpfsSpool(
	expectedByteLength: number,
	_mediaType: typeof AUDIO_WAVE_MEDIA_TYPE,
): Promise<LocalAssistanceAudioWaveSpoolV1> {
	const storage = (globalThis.navigator as Navigator | undefined)?.storage as
		| (StorageManager & Readonly<{ getDirectory?: () => Promise<FileSystemDirectoryHandle> }>)
		| undefined;
	if (!storage || typeof storage.getDirectory !== 'function') {
		throw new RangeError('Long assistance audio requires available desktop spool storage.');
	}
	const estimate = await storage.estimate();
	if (Number.isSafeInteger(estimate.quota) && Number.isSafeInteger(estimate.usage)
		&& Number(estimate.quota) - Number(estimate.usage) < expectedByteLength) {
		throw new RangeError('Long assistance audio exceeds available desktop spool storage.');
	}
	const root = await storage.getDirectory();
	const directory = await root.getDirectoryHandle('soundscaper-assistance-audio-v1', { create: true });
	const name = `${crypto.randomUUID()}.wav`;
	let handle: FileSystemFileHandle;
	let writable: FileSystemWritableFileStream;
	try {
		handle = await directory.getFileHandle(name, { create: true });
		writable = await handle.createWritable({ keepExistingData: false });
	} catch (error) {
		await directory.removeEntry(name).catch(() => undefined);
		throw error;
	}
	let written = 0;
	let settled = false;
	return Object.freeze({
		async write(chunk: Uint8Array) {
			assertSpoolChunk(chunk, written, expectedByteLength, settled);
			await writable.write(chunk.slice().buffer as ArrayBuffer);
			written += chunk.byteLength;
		},
		async close(mediaType: typeof AUDIO_WAVE_MEDIA_TYPE) {
			if (settled || written !== expectedByteLength) {
				throw new Error('The disk assistance audio spool has inexact geometry.');
			}
			await writable.close();
			settled = true;
			const body = await handle.getFile();
			return Object.freeze({ body: body.slice(0, body.size, mediaType),
				release: async () => directory.removeEntry(name) });
		},
		async abort() {
			if (!settled) {
				settled = true;
				await writable.abort().catch(() => undefined);
			}
			await directory.removeEntry(name).catch(() => undefined);
		},
	});
}

function assertSpoolChunk(
	chunk: Uint8Array,
	written: number,
	expectedByteLength: number,
	settled: boolean,
): void {
	if (settled || !(chunk instanceof Uint8Array) || chunk.byteLength < 1
		|| chunk.byteLength > MAXIMUM_ENCODED_CHUNK_BYTES
		|| written + chunk.byteLength > expectedByteLength) {
		throw new RangeError('The assistance audio spool received an invalid bounded chunk.');
	}
}

function downmixChunk(channels: readonly Float32Array[]): Float32Array {
	const frameCount = channels[0]!.length;
	const mono = new Float32Array(frameCount);
	const scale = 1 / channels.length;
	for (let frame = 0; frame < frameCount; frame += 1) {
		let sample = 0;
		for (const channel of channels) sample += channel[frame]!;
		mono[frame] = sample * scale;
	}
	return mono;
}

function assertChunkGeometry(
	channels: readonly Float32Array[],
	expectedFrames: number,
	expectedChannels: number,
): void {
	if (!Array.isArray(channels) || channels.length !== expectedChannels
		|| expectedChannels < 1 || expectedChannels > 64
		|| !Number.isSafeInteger(expectedFrames) || expectedFrames < 0
		|| channels.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== expectedFrames)) {
		throw new Error('The selected audio render returned inexact channel geometry.');
	}
}

async function yieldForCancellation(signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	signal?.throwIfAborted();
}

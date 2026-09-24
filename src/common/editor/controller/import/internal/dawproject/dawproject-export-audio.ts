/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavHeader, createWavStreamEncoder, inspectWavLayout } from '../../../../wav.js';
import type {
	NativeAudioBuffer,
	NativeProjectAudioSource,
	NativeProjectServiceRuntime,
} from '../../../document/native-project-types.ts';

/** Browser-download fallback retains the ZIP, so its total output is admitted. */
export const DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT = 256 * 1024 * 1024;
const ENCODE_PACKET_BYTE_LIMIT = 4 * 1024 * 1024;

interface StoredPcmChunk {
	readonly channels: readonly Float32Array[];
}

export function dawprojectWavByteLength(source: NativeProjectAudioSource): number {
	return inspectWavLayout({
		totalFrames: source.frameCount, channelCount: source.channelCount,
		sampleRate: source.sampleRate, float: true,
	}).byteLength;
}

/** Zip.js pulls this stream only while writing its current media entry. */
export function dawprojectWavStream(
	runtime: Pick<NativeProjectServiceRuntime, 'store' | 'sourceBuffers' | 'loadStoredSourceChannels'>,
	source: NativeProjectAudioSource,
	signal: AbortSignal,
): ReadableStream<Uint8Array> {
	const iterator = wavChunks(runtime, source, signal)[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() { await iterator.return?.(undefined); },
	});
}

async function* wavChunks(
	runtime: Pick<NativeProjectServiceRuntime, 'store' | 'sourceBuffers' | 'loadStoredSourceChannels'>,
	source: NativeProjectAudioSource,
	signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
	const options = {
		totalFrames: source.frameCount, channelCount: source.channelCount,
		sampleRate: source.sampleRate, float: true,
	};
	const encoder = createWavStreamEncoder({ ...options, collect: false });
	yield createWavHeader(options);
	let frames = 0;
	const packetFrames = Math.max(1, Math.floor(ENCODE_PACKET_BYTE_LIMIT / (source.channelCount * 4)));
	for await (const channels of sourceChunks(runtime, source, signal)) {
		signal.throwIfAborted();
		const count = channels[0]?.length ?? 0;
		if (channels.length !== source.channelCount || count < 1
			|| channels.some((channel) => channel.length !== count)
			|| frames + count > source.frameCount) {
			throw new Error(`DAWproject source ${source.id} has invalid PCM chunks.`);
		}
		for (let offset = 0; offset < count; offset += packetFrames) {
			signal.throwIfAborted();
			yield encoder.write(channels.map((channel) => channel.subarray(offset, offset + packetFrames)));
		}
		frames += count;
	}
	if (frames !== source.frameCount) throw new Error(`DAWproject source ${source.id} ended early.`);
	encoder.finalize();
}

async function* sourceChunks(
	runtime: Pick<NativeProjectServiceRuntime, 'store' | 'sourceBuffers' | 'loadStoredSourceChannels'>,
	source: NativeProjectAudioSource,
	signal: AbortSignal,
): AsyncGenerator<readonly Float32Array[]> {
	const buffer = runtime.sourceBuffers.get(source.id);
	if (buffer) {
		yield* bufferChunks(buffer, source.frameCount, signal);
		return;
	}
	if (runtime.store.readSourceChunks) {
		for await (const value of runtime.store.readSourceChunks(source.storageKey ?? source.id, { signal })) {
			yield Array.isArray(value) ? value : (value as StoredPcmChunk).channels;
		}
		return;
	}
	if (dawprojectWavByteLength(source) > DAWPROJECT_BLOB_EXPORT_BYTE_LIMIT) {
		throw new RangeError('DAWproject source exceeds the fallback PCM memory budget.');
	}
	const channels = await runtime.loadStoredSourceChannels(runtime.store, source);
	if (!channels?.length) throw new Error(`DAWproject source ${source.id} is unavailable.`);
	for (let offset = 0; offset < source.frameCount; offset += 65_536) {
		signal.throwIfAborted();
		yield channels.map((channel) => channel.subarray(offset, offset + 65_536));
	}
}

async function* bufferChunks(
	buffer: NativeAudioBuffer,
	frameCount: number,
	signal: AbortSignal,
): AsyncGenerator<readonly Float32Array[]> {
	for (let offset = 0; offset < frameCount; offset += 65_536) {
		signal.throwIfAborted();
		yield Array.from({ length: buffer.numberOfChannels }, (_, channel) => (
			buffer.getChannelData(channel).subarray(offset, offset + 65_536)
		));
	}
}

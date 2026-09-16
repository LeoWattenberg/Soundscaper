/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	instantiateDedicatedAudioPayload,
	type BrowserDedicatedAudioFormat,
	type DedicatedAudioCodecDependencies,
} from './browser-dedicated-audio-codec.ts';
import { encodeArguments, validateProfile } from './browser-dedicated-audio-profiles.ts';
import { LARGE_AUDIO_DURATION_SECONDS, LARGE_AUDIO_PCM_CHUNK_FRAMES } from './large-audio-policy.ts';

export const DEDICATED_AUDIO_STREAM_CHUNK_FRAMES = LARGE_AUDIO_PCM_CHUNK_FRAMES;
export const DEDICATED_AUDIO_STREAM_OUTPUT_BYTES = 1024 * 1024;

export interface DedicatedAudioEncodeSessionRequest {
	readonly format: BrowserDedicatedAudioFormat;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly settings: Readonly<Record<string, number>>;
}

export interface DedicatedAudioEncodeSession {
	write(input: Uint8Array, frames: number): Uint8Array<ArrayBuffer>;
	finish(): Readonly<{ bytes: Uint8Array<ArrayBuffer>; prefixPatch: Uint8Array<ArrayBuffer> }>;
	close(): void;
}

/** One persistent codec instance; neither PCM nor encoded bytes accumulate in this owner. */
export async function openDedicatedAudioEncodeSession(
	request: DedicatedAudioEncodeSessionRequest,
	dependencies: DedicatedAudioCodecDependencies = {},
): Promise<DedicatedAudioEncodeSession> {
	const { format, settings, frameCount, channelCount, sampleRate } = request;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1
		|| !Number.isSafeInteger(sampleRate) || frameCount > sampleRate * LARGE_AUDIO_DURATION_SECONDS || !Number.isSafeInteger(channelCount) || channelCount < 1) {
		throw new RangeError('The streaming encoder frame count or channel geometry is invalid.');
	}
	// The file profile's former whole-file frame bound does not constrain a session packet.
	validateProfile(format, { frameCount: Math.min(frameCount, DEDICATED_AUDIO_STREAM_CHUNK_FRAMES), channelCount, sampleRate }, settings);
	const payload = await instantiateDedicatedAudioPayload(format, dependencies);
	const memoryValue = payload.exports.memory;
	if (!(memoryValue instanceof WebAssembly.Memory)) throw new TypeError('The codec has no linear memory.');
	const memory = memoryValue;
	const fn = (suffix: string): ((...args: number[]) => number) => {
		const value = payload.exports[`${payload.prefix}_${suffix}`];
		if (typeof value !== 'function') throw new TypeError(`The codec has no ${suffix} session export.`);
		return value as (...args: number[]) => number;
	};
	const allocate = fn('allocate');
	const release = fn('free');
	const args = format === 'wavpack' ? [] : encodeArguments({
		...request, input: new Uint8Array(), maximumOutputBytes: DEDICATED_AUDIO_STREAM_OUTPUT_BYTES,
	}).slice(format === 'opus' ? 2 : 3);
	const handle = fn('stream_open')(frameCount, channelCount, sampleRate, args[0] ?? 0, args[1] ?? 0);
	if (!Number.isSafeInteger(handle) || handle <= 0) throw new Error('The codec streaming session could not be opened.');
	let inputPointer = 0;
	let outputPointer = 0;
	let writtenFrames = 0;
	let finished = false;
	let closed = false;
	try {
		inputPointer = allocate(DEDICATED_AUDIO_STREAM_CHUNK_FRAMES * channelCount * 4);
		outputPointer = allocate(DEDICATED_AUDIO_STREAM_OUTPUT_BYTES);
		if (!inputPointer || !outputPointer) throw new Error('The codec streaming buffers could not be allocated.');
	} catch (error) { close(); throw error; }
	return Object.freeze({
		write(input: Uint8Array, frames: number): Uint8Array<ArrayBuffer> {
			assertWritable();
			if (!(input instanceof Uint8Array) || !Number.isSafeInteger(frames) || frames < 1
				|| frames > DEDICATED_AUDIO_STREAM_CHUNK_FRAMES || frames > frameCount - writtenFrames
				|| input.byteLength !== frames * channelCount * 4) throw new RangeError('The streaming PCM packet geometry is invalid.');
			const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
			for (let offset = 0; offset < input.byteLength; offset += 4) {
				if (!Number.isFinite(view.getFloat32(offset, true))) throw new RangeError('The streaming PCM contains non-finite samples.');
			}
			new Uint8Array(memory.buffer, inputPointer, input.byteLength).set(input);
			if (fn('stream_write')(handle, inputPointer, frames) !== 1) throw new Error('The incremental codec failed while encoding PCM.');
			writtenFrames += frames;
			return read('stream_read');
		},
		finish() {
			assertWritable();
			if (writtenFrames !== frameCount) throw new RangeError('The streaming encoder frame count does not match its complete input.');
			if (fn('stream_finish')(handle) !== 1) throw new Error('The incremental codec failed while finishing its stream.');
			finished = true;
			return Object.freeze({ bytes: read('stream_read'), prefixPatch: read('stream_patch') });
		},
		close,
	});
	function read(suffix: string): Uint8Array<ArrayBuffer> {
		const length = fn(suffix)(handle, outputPointer, DEDICATED_AUDIO_STREAM_OUTPUT_BYTES);
		if (!Number.isSafeInteger(length) || length < 0 || length > DEDICATED_AUDIO_STREAM_OUTPUT_BYTES) {
			throw new RangeError('The incremental codec exceeded its bounded output packet.');
		}
		return Uint8Array.from(new Uint8Array(memory.buffer, outputPointer, length));
	}
	function assertWritable(): void {
		if (closed || finished) throw new Error('The incremental codec session is finished or closed.');
	}
	function close(): void {
		if (closed) return;
		closed = true;
		if (inputPointer) release(inputPointer);
		if (outputPointer) release(outputPointer);
		fn('stream_close')(handle);
	}
}

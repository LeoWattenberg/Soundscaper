/* SPDX-License-Identifier: AGPL-3.0-only */
import { EncodedPacket } from 'mediabunny';
import { browserWebCodecsAudioConfiguration, type BrowserWebCodecsAudioGeometry } from './browser-webcodecs-audio-profile.ts';

export const NATIVE_AAC_ACCESS_UNIT_FRAMES = 1_024;
export const NATIVE_AAC_MAXIMUM_QUEUE_DEPTH = 4;
export const NATIVE_AAC_MAXIMUM_PENDING_PACKETS = 256;
export const NATIVE_AAC_MAXIMUM_PENDING_BYTES = 32 * 1024 ** 2;

export interface NativeAacChunk {
	readonly byteLength: number;
	readonly timestamp: number;
	readonly duration?: number | null;
	readonly type: 'key' | 'delta';
	copyTo(destination: Uint8Array): void;
}
export interface NativeAacAudioData { close(): void }
export interface NativeAacEncoder extends EventTarget {
	readonly state: string;
	readonly encodeQueueSize: number;
	configure(configuration: Readonly<Record<string, unknown>>): void;
	encode(data: NativeAacAudioData): void;
	flush(): Promise<void>;
	close(): void;
}
export interface NativeAacResources {
	createEncoder(callbacks: { output(chunk: NativeAacChunk, metadata?: EncodedAudioChunkMetadata): void; error(error: unknown): void }): NativeAacEncoder;
	createAudioData(init: { format: 'f32'; sampleRate: number; numberOfChannels: number; numberOfFrames: number; timestamp: number; data: Uint8Array<ArrayBuffer> }): NativeAacAudioData;
}
interface NativeAacRequest extends BrowserWebCodecsAudioGeometry {
	readonly signal?: AbortSignal;
	acceptPacket(packet: EncodedPacket, metadata?: EncodedAudioChunkMetadata): Promise<void>;
}

/** Own the native resources so abort can close them even while flush never settles. */
export function createNativeAacEncoder(request: NativeAacRequest, resources = nativeAacResources()) {
	let encoder: NativeAacEncoder | null = null;
	let closed = false;
	let failed = false;
	let failure: unknown;
	let rejectFailure!: (error: unknown) => void;
	const failurePromise = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
	void failurePromise.catch(() => undefined);
	let pending = Promise.resolve();
	let pendingPackets = 0;
	let pendingBytes = 0;
	let inputFrames = 0;
	let encodedFrames = 0;
	const closeEncoder = (): void => {
		if (closed || !encoder) return;
		closed = true;
		if (encoder.state !== 'closed') { try { encoder.close(); } catch { /* Keep the original failure when native cleanup also throws. */ } }
	};
	const fail = (error: unknown): void => {
		if (failed) return;
		failed = true; failure = error;
		rejectFailure(error);
		closeEncoder();
	};
	const assertCurrent = (): void => {
		if (request.signal?.aborted) fail(abortReason(request.signal));
		if (failed) throw failure;
	};
	const wait = async <Value>(operation: PromiseLike<Value>): Promise<Value> => {
		const observed = Promise.resolve(operation);
		void observed.catch(() => undefined);
		assertCurrent();
		const value = await Promise.race([observed, failurePromise]);
		assertCurrent();
		return value;
	};
	const onAbort = (): void => { fail(abortReason(request.signal!)); };
	const output = (chunk: NativeAacChunk, metadata?: EncodedAudioChunkMetadata): void => {
		try {
			assertCurrent();
			if (encodedFrames === 0 || metadata?.decoderConfig) validateNativeAacMetadata(metadata, request);
			if (!Number.isSafeInteger(chunk.byteLength) || chunk.byteLength < 1 || chunk.byteLength > 1024 ** 2
				|| chunk.type !== 'key' || !microsecondTimingMatches(chunk.timestamp, encodedFrames, request.sampleRate)
				|| (chunk.duration != null && chunk.duration !== 0
					&& !microsecondTimingMatches(chunk.duration, NATIVE_AAC_ACCESS_UNIT_FRAMES, request.sampleRate))
				|| encodedFrames + NATIVE_AAC_ACCESS_UNIT_FRAMES > inputFrames + NATIVE_AAC_ACCESS_UNIT_FRAMES) {
				throw new RangeError('The native AAC encoded packet geometry is outside its qualified profile.');
			}
			if (++pendingPackets > NATIVE_AAC_MAXIMUM_PENDING_PACKETS
				|| (pendingBytes += chunk.byteLength) > NATIVE_AAC_MAXIMUM_PENDING_BYTES) {
				throw new RangeError('The native AAC mux queue exceeds its bounded streaming profile.');
			}
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			const packet = new EncodedPacket(bytes, 'key', encodedFrames / request.sampleRate, NATIVE_AAC_ACCESS_UNIT_FRAMES / request.sampleRate);
			encodedFrames += NATIVE_AAC_ACCESS_UNIT_FRAMES;
			pending = pending.then(async () => {
				assertCurrent();
				await request.acceptPacket(packet, metadata);
			}).finally(() => { pendingPackets--; pendingBytes -= bytes.byteLength; });
			void pending.catch(fail);
		} catch (error) { fail(error); }
	};
	request.signal?.addEventListener('abort', onAbort, { once: true });
	try {
		assertCurrent();
		encoder = resources.createEncoder({ output, error: fail });
		assertCurrent();
		encoder.configure(browserWebCodecsAudioConfiguration('aac', request));
		assertCurrent();
	} catch (error) {
		fail(error);
		closeEncoder();
		request.signal?.removeEventListener('abort', onAbort);
		throw error;
	}
	const add = async (bytes: Uint8Array<ArrayBuffer>, offset: number): Promise<void> => {
		assertCurrent();
		if (closed || bytes.byteLength !== NATIVE_AAC_ACCESS_UNIT_FRAMES * request.channelCount * 4 || offset !== inputFrames
			|| !Number.isSafeInteger(inputFrames + NATIVE_AAC_ACCESS_UNIT_FRAMES)) {
			throw new RangeError('The native AAC input must be one contiguous complete access unit.');
		}
		await wait(pending);
		const audio = resources.createAudioData({ format: 'f32', sampleRate: request.sampleRate,
			numberOfChannels: request.channelCount, numberOfFrames: NATIVE_AAC_ACCESS_UNIT_FRAMES,
			timestamp: Math.round(offset / request.sampleRate * 1_000_000), data: bytes });
		try {
			inputFrames += NATIVE_AAC_ACCESS_UNIT_FRAMES;
			encoder!.encode(audio);
		} catch (error) { fail(error); } finally { audio.close(); }
		assertCurrent();
		while (encoder!.encodeQueueSize >= NATIVE_AAC_MAXIMUM_QUEUE_DEPTH) {
			let resume!: () => void;
			const dequeued = new Promise<void>((resolve) => { resume = resolve; });
			encoder!.addEventListener('dequeue', resume, { once: true });
			try {
				if (encoder!.encodeQueueSize < NATIVE_AAC_MAXIMUM_QUEUE_DEPTH) resume();
				await wait(dequeued);
			} finally { encoder!.removeEventListener('dequeue', resume); }
		}
		await wait(pending);
	};
	const flush = async (): Promise<number> => {
		assertCurrent();
		try {
			await wait(encoder!.flush());
			await wait(pending);
			return encodedFrames;
		} finally { closeEncoder(); }
	};
	const dispose = (): void => {
		request.signal?.removeEventListener('abort', onAbort);
		closeEncoder();
	};
	return Object.freeze({ add, flush, wait, assertCurrent, dispose });
}

/** Capability probes and mux operations also settle immediately on abort. */
export async function awaitNativeAacAbort<Value>(operation: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	const observed = Promise.resolve(operation);
	void observed.catch(() => undefined);
	if (!signal) return await observed;
	if (signal.aborted) throw abortReason(signal);
	let rejectAbort!: (reason: unknown) => void;
	const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
	const onAbort = (): void => { rejectAbort(abortReason(signal)); };
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		if (signal.aborted) onAbort();
		return await Promise.race([observed, aborted]);
	} finally { signal.removeEventListener('abort', onAbort); }
}

function microsecondTimingMatches(microseconds: number, frames: number, rate: number): boolean {
	// The native API uses integer microseconds; only that quantization is admitted.
	return Number.isSafeInteger(microseconds) && Math.abs(microseconds - frames / rate * 1_000_000) <= 1;
}
function validateNativeAacMetadata(metadata: EncodedAudioChunkMetadata | undefined, request: BrowserWebCodecsAudioGeometry): void {
	const config = metadata?.decoderConfig;
	const description = config?.description;
	const invalid = (): never => { throw new RangeError('The native AAC decoder configuration is outside its qualified AAC-LC profile.'); };
	if (config?.codec !== 'mp4a.40.2' || config.sampleRate !== request.sampleRate || config.numberOfChannels !== request.channelCount
		|| !description || description.byteLength < 2 || description.byteLength > 64) invalid();
	if (!description) return invalid();
	const bytes = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
	let position = 0;
	const read = (count: number): number => {
		if (position + count > bytes.byteLength * 8) invalid();
		let value = 0;
		while (count--) { value = value * 2 + ((bytes[position >> 3]! >> (7 - (position++ & 7))) & 1); }
		return value;
	};
	const objectType = read(5);
	const rateIndex = read(4);
	const sampleRate = rateIndex === 15 ? read(24) : [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350][rateIndex];
	const channelCount = [0, 1, 2, 3, 4, 5, 6, 8][read(4)];
	if (objectType !== 2 || sampleRate !== request.sampleRate || channelCount !== request.channelCount || read(1) !== 0) invalid();
}
function abortReason(signal: AbortSignal): unknown { return signal.reason ?? new DOMException('The AAC export was cancelled.', 'AbortError'); }
function nativeAacResources(): NativeAacResources {
	const globals = globalThis as unknown as { AudioEncoder: new (callbacks: Parameters<NativeAacResources['createEncoder']>[0]) => NativeAacEncoder;
		AudioData: new (init: Parameters<NativeAacResources['createAudioData']>[0]) => NativeAacAudioData };
	return { createEncoder: (callbacks) => new globals.AudioEncoder(callbacks), createAudioData: (init) => new globals.AudioData(init) };
}

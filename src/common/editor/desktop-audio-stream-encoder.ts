/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeDesktopAudioStreamCommand, audioStreamRecord, audioStreamInteger,
	DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES, DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES,
	type DesktopAudioStreamCommand, type DesktopAudioStreamPlan } from '../../../desktop/desktop-audio-stream-contract.ts';
import { registerFileBackedExport } from './file-backed-audio-export.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import type { WavPcmDescriptor } from './wav-pcm-chunk-reader.ts';
import { applyMediaChannelMapping } from './media-export.js';
import { writeInterleavedFloat32Pcm } from './interleaved-float32-pcm.ts';
import { assertFfmpegOutputReady, abortFfmpegOutputSink, streamFfmpegOutputFile,
	type FfmpegOutputSink } from './ffmpeg-output-stream.ts';

export interface DesktopAudioStreamEncoderSettings {
	readonly signal?: AbortSignal; readonly assertCurrent?: () => void;
	readonly maximumOutputChunkBytes?: number; readonly onProgress?: (value: number) => void;
}
export interface DesktopAudioStreamFileResult {
	readonly blob: Blob; readonly bytes: null; readonly extension: string; readonly mimeType: string;
	cleanup(): Promise<void>;
}
export interface DesktopAudioStreamEncoderRequest {
	readonly file: Blob; readonly plan: DesktopAudioStreamPlan; readonly channelMapping: unknown;
	readonly extension: string; readonly mimeType: string;
	readonly settings: DesktopAudioStreamEncoderSettings;
}
export type DesktopAudioStreamCommandBridge = (command: DesktopAudioStreamCommand) => Promise<unknown> | unknown;

/** Preserve runtime disposal and task cancellation throughout native stream work. */
export async function withDesktopAudioStreamOwnership<Result>(request: DesktopAudioStreamEncoderRequest,
	requestId: string, active: Map<string, { cancel(reason: unknown): void }>,
	operation: (request: DesktopAudioStreamEncoderRequest) => Promise<Result>,
): Promise<Result> {
	const controller = new AbortController(); const signal = request.settings.signal;
	const cancel = (reason: unknown): void => { controller.abort(reason); };
	const abort = (): void => { cancel(signal?.reason); };
	active.set(requestId, { cancel }); signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	try { return await operation({ ...request, settings: { ...request.settings, signal: controller.signal } }); }
	finally { signal?.removeEventListener('abort', abort); active.delete(requestId); }
}

/** Transfer one mapped WAV through acknowledged bounded chunks into native scratch. */
export async function encodeDesktopAudioStreamFile(request: DesktopAudioStreamEncoderRequest,
	bridge: DesktopAudioStreamCommandBridge,
): Promise<DesktopAudioStreamFileResult> {
	assertFfmpegOutputReady(request.settings);
	const begun = audioStreamRecord(await bridge(normalizeDesktopAudioStreamCommand({ type: 'begin', plan: request.plan })), ['operationId']);
	const operationId = String(begun.operationId);
	let released = false;
	let cleaning: Promise<void> | null = null;
	const cleanup = (): Promise<void> => {
		if (cleaning) return cleaning; released = true;
		cleaning = Promise.resolve().then(async () => { await bridge(normalizeDesktopAudioStreamCommand({ type: 'delete', operationId })); })
			.catch((error: unknown) => { cleaning = null; throw error; });
		return cleaning;
	};
	const abort = (): void => { void cleanup().catch(() => undefined); };
	request.settings.signal?.addEventListener('abort', abort, { once: true });
	try {
		assertFfmpegOutputReady(request.settings);
		const descriptor = await inspectWavBlobPcm(request.file, { signal: request.settings.signal }) as WavPcmDescriptor;
		let offset = 0;
		await streamWavBlobPcm(request.file, { descriptor, signal: request.settings.signal,
			chunkFrames: DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_FRAMES,
			async onChunk(packet: readonly Float32Array[]) {
				assertFfmpegOutputReady(request.settings);
				const channels = applyMediaChannelMapping(packet, request.channelMapping as string) as readonly Float32Array[];
				if (channels.length !== request.plan.tuple.channelCount) throw new Error('Desktop audio streaming channel mapping drifted.');
				const frames = channels[0]?.length ?? 0; const bytes = new Uint8Array(frames * channels.length * 4);
				writeInterleavedFloat32Pcm(bytes, channels, { frameCount: frames, nonFinite: 'preserve' });
				const acknowledgement = audioStreamRecord(await bridge(normalizeDesktopAudioStreamCommand({ type: 'write', operationId, offset, bytes })), ['offset']);
				if (acknowledgement.offset !== offset + bytes.byteLength) throw new Error('Desktop audio stream acknowledgement drifted.');
				offset += bytes.byteLength; assertFfmpegOutputReady(request.settings);
			},
		});
		const result = audioStreamRecord(await executeWithProgress(operationId, request, bridge), ['byteLength']);
		assertFfmpegOutputReady(request.settings);
		const byteLength = audioStreamInteger(result.byteLength, 1, request.plan.maximumOutputBytes, 'output length');
		const read = async (offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
			if (released) throw new Error('The desktop encoded audio file was released.');
			assertFfmpegOutputReady(request.settings);
			const value = await bridge(normalizeDesktopAudioStreamCommand({ type: 'read', operationId, offset, maximumBytes: length }));
			assertFfmpegOutputReady(request.settings);
			if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error('The desktop encoded audio range drifted.');
			return value.slice();
		};
		const blob = registerFileBackedExport(new EncodedAudioRangeBlob(byteLength, request.mimeType, 0, read));
		const { validateStreamedAudioOutput } = await import('./browser-streamed-audio-output-validation.ts');
		await validateStreamedAudioOutput(blob, { format: request.plan.tuple.format,
			frameCount: request.plan.frameCount, channelCount: request.plan.tuple.channelCount,
			sampleRate: request.plan.tuple.sampleRate, signal: request.settings.signal });
		assertFfmpegOutputReady(request.settings);
		return Object.freeze({ blob, bytes: null, extension: request.extension, mimeType: request.mimeType, cleanup });
	} catch (error) {
		const failures: unknown[] = [error];
		try { await cleanup(); } catch (cleanupError) { failures.push(cleanupError); }
		if (failures.length > 1) throw new AggregateError(failures, 'Desktop streaming audio and cleanup failed.', { cause: error });
		throw error;
	} finally { request.settings.signal?.removeEventListener('abort', abort); }
}

export async function encodeDesktopAudioStreamToSink<Output>(request: DesktopAudioStreamEncoderRequest,
	bridge: DesktopAudioStreamCommandBridge, sink: FfmpegOutputSink<Output>,
): Promise<Readonly<{ output: Output; byteLength: number; chunkCount: number; extension: string; mimeType: string }>> {
	let owned: DesktopAudioStreamFileResult | null = null; let streaming = false;
	let result: Readonly<{ output: Output; byteLength: number; chunkCount: number; extension: string; mimeType: string }> | null = null;
	const failures: unknown[] = [];
	try {
		owned = await encodeDesktopAudioStreamFile(request, bridge);
		streaming = true;
		const output = owned;
		const streamed = await streamFfmpegOutputFile({ async statFile() { return { size: output.blob.size }; },
			async readFileRange(_name, offset, maximumBytes) { return new Uint8Array(await output.blob.slice(offset, offset + maximumBytes).arrayBuffer()); },
		}, 'desktop-streamed-audio', sink, { signal: request.settings.signal, assertCurrent: request.settings.assertCurrent,
			maximumChunkBytes: request.settings.maximumOutputChunkBytes });
		result = Object.freeze({ ...streamed, extension: owned.extension, mimeType: owned.mimeType });
	} catch (error) { failures.push(streaming ? error : await abortFfmpegOutputSink(sink, error)); }
	if (owned) { try { await owned.cleanup(); } catch (error) { failures.push(error); } }
	if (failures.length > 1) throw new AggregateError(failures, 'Desktop streaming destination and cleanup failed.', { cause: failures[0] });
	if (failures.length) throw failures[0];
	return result!;
}

async function executeWithProgress(operationId: string, request: DesktopAudioStreamEncoderRequest, bridge: DesktopAudioStreamCommandBridge): Promise<unknown> {
	let finished = false; let lastFraction = 0;
	const execution = Promise.resolve().then(() => bridge(normalizeDesktopAudioStreamCommand({ type: 'execute', operationId })));
	const outcome = execution.finally(() => { finished = true; });
	void outcome.catch(() => undefined);
	while (!finished) {
			const ready = await Promise.race([outcome.then(() => true), new Promise<false>((resolve) => { setTimeout(() => resolve(false), 200); })]);
			if (ready || finished) break;
			assertFfmpegOutputReady(request.settings);
			const status = audioStreamRecord(await bridge(normalizeDesktopAudioStreamCommand({ type: 'status', operationId })), ['frames', 'frameCount']);
			const frames = audioStreamInteger(status.frames, 0, request.plan.frameCount, 'progress frames');
			if (status.frameCount !== request.plan.frameCount) throw new Error('Desktop encoder progress geometry drifted.');
			const fraction = frames / request.plan.frameCount;
			if (fraction >= lastFraction) { lastFraction = fraction; request.settings.onProgress?.(fraction); }
	}
	const result = await outcome; request.settings.onProgress?.(1); return result;
}

class EncodedAudioRangeBlob extends Blob {
	readonly #length: number; readonly #type: string; readonly #offset: number;
	readonly #read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>;
	constructor(length: number, type: string, offset: number, read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>) {
		super(); this.#length = length; this.#type = type; this.#offset = offset; this.#read = read;
	}
	override get size(): number { return this.#length; }
	override get type(): string { return this.#type; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = Math.min(this.size, Math.max(0, start < 0 ? this.size + Math.trunc(start) : Math.trunc(start)));
		const last = Math.min(this.size, Math.max(0, end < 0 ? this.size + Math.trunc(end) : Math.trunc(end)));
		return new EncodedAudioRangeBlob(Math.max(0, last - first), contentType, this.#offset + first, this.#read);
	}
	override async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.size > DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES) throw new RangeError('Desktop encoded audio requires bounded 1 MiB reads.');
		if (!this.size) return new ArrayBuffer(0);
		return (await this.#read(this.#offset, this.size)).buffer;
	}
	override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
	override async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		let offset = 0;
		return new ReadableStream({ pull: async (controller) => {
			if (offset >= this.size) { controller.close(); return; }
			const length = Math.min(DESKTOP_AUDIO_STREAM_MAXIMUM_PACKET_BYTES, this.size - offset);
			controller.enqueue(await this.#read(this.#offset + offset, length)); offset += length;
		} });
	}
}

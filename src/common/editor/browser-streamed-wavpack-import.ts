/* SPDX-License-Identifier: AGPL-3.0-only */

import { materializeBundledWavPackDecodeGroup, parseBundledWavPackStream } from '../../../desktop/bundled-wavpack-stream.ts';
import type { StreamedAudioImportSession } from './browser-streamed-audio-import.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

export interface WavPackImportGroupDecoder {
	decode(file: Blob, options: Readonly<Record<string, unknown>>): PromiseLike<Readonly<{
		channels: readonly Float32Array[]; sampleRate: number;
	}>>;
}

const MAXIMUM_GROUP_BYTES = 4 * 1024 * 1024;
const MAXIMUM_GROUP_FRAMES = 65_536;
const HEADER_BYTES = 32;

interface Group {
	readonly encoded: Uint8Array<ArrayBuffer>;
	readonly offset: number;
	readonly byteLength: number;
	readonly frameCount: number;
	readonly totalFrames: number;
	readonly blockIndex: number;
	readonly sampleRate: number;
	readonly channelCount: number;
}

/** Read and decode one authenticated self-contained WavPack block group at a time. */
export async function openStreamedWavPackImportSession(
	file: Blob, signal?: AbortSignal, suppliedDecoder?: WavPackImportGroupDecoder,
): Promise<StreamedAudioImportSession> {
	signal?.throwIfAborted();
	const first = await readGroup(file, 0, signal);
	if (first.blockIndex !== 0) throw new Error('The WavPack original does not begin at source frame zero.');
	let decoder = suppliedDecoder;
	let disposeDecoder: (() => void) | null = null;
	let disposed = false;
	const assertCurrent = (): void => {
		signal?.throwIfAborted();
		if (disposed) throw new Error('The WavPack import decoder is closed.');
	};
	return Object.freeze({
		sampleRate: first.sampleRate, channelCount: first.channelCount,
		durationSeconds: first.totalFrames / first.sampleRate, timelineOrigin: 0,
		async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
			assertCurrent();
			if (!decoder) {
				const { createDefaultWavPackGroupDecoder } = await import('./browser-streamed-wavpack-decoder.ts');
				assertCurrent();
				const runtime = createDefaultWavPackGroupDecoder();
				decoder = runtime;
				disposeDecoder = () => runtime.dispose();
			}
			let offset = 0;
			let frames = 0;
			while (offset < file.size) {
				assertCurrent();
				const group = offset === 0 ? first : await readGroup(file, offset, signal);
				assertCurrent();
				if (group.totalFrames !== first.totalFrames || group.blockIndex !== frames
					|| group.sampleRate !== first.sampleRate || group.channelCount !== first.channelCount) {
					throw new Error('WavPack source groups are non-contiguous or change source geometry.');
				}
				const decoded = await decoder.decode(new Blob([group.encoded], { type: 'audio/wavpack' }), {
					sampleRate: group.sampleRate, ...(signal ? { signal } : {}),
				});
				assertCurrent();
				if (decoded.sampleRate !== group.sampleRate || decoded.channels.length !== group.channelCount
					|| decoded.channels.some((channel) => channel.length !== group.frameCount)) {
					throw new Error('The bounded WavPack decoder returned inconsistent source geometry.');
				}
				const channels = decoded.channels;
				yield {
					timestamp: frames / group.sampleRate, duration: group.frameCount / group.sampleRate,
					sampleRate: group.sampleRate, numberOfChannels: group.channelCount, numberOfFrames: group.frameCount,
					copyTo(destination, options) {
						const start = options.frameOffset ?? 0;
						destination.set(channels[options.planeIndex]!.subarray(start, start + (options.frameCount ?? group.frameCount)));
					},
					close() { /* The source chunk owner releases the bounded planar arrays after this sample. */ },
				};
				frames += group.frameCount;
				offset += group.byteLength;
			}
			if (frames !== first.totalFrames) throw new Error('The WavPack original ends before its declared source frames.');
		},
		dispose() { if (!disposed) { disposed = true; disposeDecoder?.(); } },
	});
}

async function readGroup(file: Blob, offset: number, signal?: AbortSignal): Promise<Group> {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	let length = 0;
	let frameCount = 0;
	let totalFrames = 0;
	let blockIndex = 0;
	for (let block = 0; block < 8; block += 1) {
		const header = await read(file, offset + length, HEADER_BYTES, signal);
		if (String.fromCharCode(...header.subarray(0, 4)) !== 'wvpk') throw new Error('The WavPack block header is missing.');
		const view = new DataView(header.buffer);
		const bytes = view.getUint32(4, true) + 8;
		const flags = view.getUint32(24, true);
		const initial = Boolean(flags & 0x800);
		const final = Boolean(flags & 0x1000);
		if ((block === 0) !== initial || header[10] || header[11]
			|| bytes < HEADER_BYTES || bytes > MAXIMUM_GROUP_BYTES - length) throw new Error('The WavPack block group exceeds its bounded layout.');
		const declaredFrames = view.getUint32(12, true);
		const declaredIndex = view.getUint32(16, true);
		const declaredBlockFrames = view.getUint32(20, true);
		if (!block) { totalFrames = declaredFrames; blockIndex = declaredIndex; frameCount = declaredBlockFrames; }
		if (declaredFrames !== totalFrames || declaredIndex !== blockIndex || declaredBlockFrames !== frameCount
			|| frameCount < 1 || frameCount > MAXIMUM_GROUP_FRAMES || totalFrames < 1 || totalFrames === 0xffff_ffff
			|| blockIndex + frameCount > totalFrames) throw new Error('The WavPack original declares inconsistent block geometry.');
		const body = await read(file, offset + length, bytes, signal);
		verifyOriginalBlockChecksum(body, flags);
		parts.push(body);
		length += bytes;
		if (final) {
			const original = new Uint8Array(length);
			let position = 0;
			for (const part of parts) { original.set(part, position); position += part.length; }
			const encoded = Uint8Array.from(materializeBundledWavPackDecodeGroup(original, {
				offset: 0, byteLength: length, frameCount, blockIndex, blocks: [],
			}));
			const geometry = parseBundledWavPackStream(encoded);
			return Object.freeze({ encoded, offset, byteLength: length, frameCount, blockIndex, totalFrames,
				sampleRate: geometry.sampleRate, channelCount: geometry.channelCount });
		}
	}
	throw new Error('The WavPack original has an incomplete bounded channel group.');
}

async function read(file: Blob, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	signal?.throwIfAborted();
	if (offset < 0 || length < 1 || offset + length > file.size) throw new Error('The WavPack original is truncated.');
	const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
	signal?.throwIfAborted();
	if (bytes.length !== length) throw new Error('The WavPack original returned a short byte range.');
	return bytes;
}

/** Authenticate the original header and metadata before rebasing its sample indexes. */
function verifyOriginalBlockChecksum(bytes: Uint8Array, flags: number): void {
	let position = HEADER_BYTES;
	let checksums = 0;
	let entries = 0;
	while (position < bytes.length) {
		if (++entries > 4096 || position + 2 > bytes.length) throw new Error('The WavPack metadata is malformed.');
		const start = position;
		const id = bytes[position++]!;
		let words = bytes[position++]!;
		if (id & 0x80) {
			if (position + 2 > bytes.length) throw new Error('The WavPack metadata is truncated.');
			words += bytes[position++]! << 8;
			words += bytes[position++]! << 16;
		}
		const dataLength = words * 2 - ((id & 0x40) ? 1 : 0);
		if (dataLength < 0 || position + words * 2 > bytes.length) throw new Error('The WavPack metadata size is invalid.');
		if ((id & 0x3f) === 0x2f) {
			checksums += 1;
			if (id & 0x80 || ![2, 4].includes(dataLength) || start % 2 || position + words * 2 !== bytes.length) {
				throw new Error('The WavPack original checksum declaration is malformed.');
			}
			let checksum = 0xffff_ffff;
			for (let index = 0; index < start; index += 2) checksum = (Math.imul(checksum, 3) + bytes[index]! + (bytes[index + 1]! << 8)) >>> 0;
			if (dataLength === 2) checksum = (checksum ^ (checksum >>> 16)) & 0xffff;
			let actual = 0;
			for (let index = 0; index < dataLength; index += 1) actual += bytes[position + index]! * 2 ** (index * 8);
			if (checksum !== actual) throw new Error('The WavPack original block checksum failed.');
		}
		position += words * 2;
	}
	if (!(flags & 0x1000_0000) || checksums !== 1) throw new Error('The WavPack original is missing its reviewed block checksum.');
}

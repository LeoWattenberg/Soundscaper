/* SPDX-License-Identifier: AGPL-3.0-only */

const FRAME_SAMPLES = 1024;
const MAXIMUM_TAG_BYTES = 128;
const MAXIMUM_METADATA_ITEM_BYTES = 1024 * 1024;
const MAXIMUM_BOX_HEADERS = 8192;

interface AacEncodedGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly encodedFrames: number;
}
export interface AacSourceGeometry {
	readonly sourceFrames: number;
	readonly leadingFrames: number;
	readonly trailingFrames: number;
}

export function aacSourceMetadata(sampleRate: number, channelCount: number, sourceFrames: number): string {
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000
		|| !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 32
		|| !Number.isSafeInteger(sourceFrames) || sourceFrames < 1
		|| !Number.isSafeInteger(sourceFrames * channelCount * 4)) invalidGeometry();
	return `SoundscaperAAC1:${sampleRate}:${channelCount}:${sourceFrames}`;
}

/** This tag can explain at most one leading AAC-LC frame and one partial final frame. */
export function validateAacSourceGeometry(metadata: unknown, actual: AacEncodedGeometry): Readonly<AacSourceGeometry> {
	if (typeof metadata !== 'string' || metadata.length > MAXIMUM_TAG_BYTES
		|| !/^SoundscaperAAC1:([1-9]\d{0,5}):([1-9]\d?):([1-9]\d{0,15})$/u.test(metadata)) invalidGeometry();
	const fields = metadata.split(':');
	const rate = Number(fields[1]);
	const channels = Number(fields[2]);
	const sourceFrames = Number(fields[3]);
	if (aacSourceMetadata(rate, channels, sourceFrames) !== metadata || rate !== actual.sampleRate || channels !== actual.channelCount
		|| !Number.isSafeInteger(actual.encodedFrames) || actual.encodedFrames < FRAME_SAMPLES) invalidGeometry();
	const paddedFrames = Math.ceil(sourceFrames / FRAME_SAMPLES) * FRAME_SAMPLES;
	const leadingFrames = actual.encodedFrames - paddedFrames;
	if (!Number.isSafeInteger(paddedFrames) || (leadingFrames !== 0 && leadingFrames !== FRAME_SAMPLES)) invalidGeometry();
	return Object.freeze({ sourceFrames, leadingFrames, trailingFrames: paddedFrames - sourceFrames });
}

interface BoxHeader { readonly type: string; readonly start: number; readonly end: number }

/** Read only box headers and the small private tag; never ask the demuxer for all metadata. */
export async function readAacSourceMetadata(blob: Blob, signal?: AbortSignal): Promise<string | null> {
	signal?.throwIfAborted();
	if (blob.size < 8) return null;
	const prefix = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
	signal?.throwIfAborted();
	if (ascii(prefix, 4) !== 'ftyp') return null;
	let headers = 0;
	let metadata: string | null = null;
	const read = async (start: number, count: number): Promise<Uint8Array> => {
		signal?.throwIfAborted();
		if (count < 1 || count > MAXIMUM_TAG_BYTES || start + count > blob.size) invalidMetadata();
		const bytes = new Uint8Array(await blob.slice(start, start + count).arrayBuffer());
		signal?.throwIfAborted();
		if (bytes.length !== count) invalidMetadata();
		return bytes;
	};
	const header = async (offset: number, end: number): Promise<BoxHeader> => {
		if (++headers > MAXIMUM_BOX_HEADERS || offset + 8 > end) invalidMetadata();
		const bytes = await read(offset, 8);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
		let size = view.getUint32(0);
		let headerSize = 8;
		if (size === 1) {
			if (offset + 16 > end) invalidMetadata();
			const extended = await read(offset + 8, 8);
			size = Number(new DataView(extended.buffer, extended.byteOffset, extended.length).getBigUint64(0));
			headerSize = 16;
		} else if (size === 0) size = end - offset;
		if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) invalidMetadata();
		return { type: ascii(bytes, 4), start: offset + headerSize, end: offset + size };
	};
	const scan = async (start: number, end: number, parent: string): Promise<void> => {
		let offset = start;
		while (offset < end) {
			const child = await header(offset, end);
			if ((parent === 'udta' && child.type !== 'meta') || parent === 'ilst') {
				if (child.end - child.start > MAXIMUM_METADATA_ITEM_BYTES) invalidMetadata();
			}
			if ((parent === 'moov' && child.type === 'udta') || (parent === 'meta' && child.type === 'ilst')
				|| (parent === 'ilst' && child.type === 'scaf')) await scan(child.start, child.end, child.type);
			else if (parent === 'udta' && child.type === 'meta') {
				if (child.end - child.start < 4) invalidMetadata();
				await scan(child.start + 4, child.end, 'meta');
			} else if (parent === 'scaf') {
				if (child.type !== 'data' || metadata !== null || child.end - child.start < 9
					|| child.end - child.start > MAXIMUM_TAG_BYTES) invalidMetadata();
				const data = await read(child.start, child.end - child.start);
				const view = new DataView(data.buffer, data.byteOffset, data.length);
				if (view.getUint32(0) !== 1 || view.getUint32(4) !== 0 || data.subarray(8).some((byte) => byte > 127)) invalidMetadata();
				metadata = new TextDecoder().decode(data.subarray(8));
			}
			offset = child.end;
		}
	};
	let offset = 0;
	while (offset < blob.size) {
		const child = await header(offset, blob.size);
		if (child.type === 'moov') { await scan(child.start, child.end, 'moov'); return metadata; }
		offset = child.end;
	}
	return null;
}

function ascii(bytes: Uint8Array, offset: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
function invalidGeometry(): never { throw new Error('The AAC source geometry does not match its encoded AAC-LC frames.'); }
function invalidMetadata(): never { throw new Error('The AAC source metadata exceeds its bounded or valid MP4 box geometry.'); }

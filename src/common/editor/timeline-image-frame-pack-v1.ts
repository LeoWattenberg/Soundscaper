/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { unzlibSync, zlibSync } from 'fflate';

import {
	FRAMESCAPER_IMAGE_MODEL_LIMITS_V1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageFrameTimingV1,
	type FramescaperImageSourceV1,
	type FramescaperImageTimingModeV1,
} from './timeline-image-model-v30.ts';
import {
	decodeFramescaperImageConversionReceiptV1,
	encodeFramescaperImageConversionReceiptV1,
} from './timeline-image-conversion-receipt-v1.ts';
import {
	checkedFramescaperImageAssetAdd,
	checkedFramescaperImageAssetMultiply,
	createFramescaperImageFramePackSectionsV1,
	decodeFramescaperImageFramePackHeaderV1,
	decodeFramescaperImageFramePackIndexesV1,
	encodeFramescaperImageFramePackHeaderV1,
	encodeFramescaperImageFramePackIndexV1,
	FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
	FramescaperImageFramePackV1Error,
	type FramescaperImageEncodedFrameLayoutV1,
} from './timeline-image-frame-pack-v1-layout.ts';

export {
	FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_VERSION,
	FramescaperImageFramePackV1Error,
} from './timeline-image-frame-pack-v1-layout.ts';
export type { FramescaperImageReceiptJsonV1 } from './timeline-image-conversion-receipt-v1.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FramescaperImageFramePackFrameInputV1 extends FramescaperImageFrameTimingV1 {
	readonly rgba: Uint8Array;
}

export interface FramescaperImageFramePackInputV1 {
	readonly original: Uint8Array;
	readonly receipt: Readonly<Record<string, unknown>>;
	readonly width: number;
	readonly height: number;
	readonly timingMode: FramescaperImageTimingModeV1;
	readonly frames: readonly FramescaperImageFramePackFrameInputV1[];
}

export interface FramescaperImageFramePackPublicationV1 {
	readonly bytes: Uint8Array;
	readonly contentSha256: string;
	readonly assetByteLength: number;
	readonly originalSha256: string;
	readonly originalByteLength: number;
	readonly conversionReceiptSha256: string;
	readonly width: number;
	readonly height: number;
	readonly hasAlpha: boolean;
	readonly frameCount: number;
	readonly durationTicks: string;
	readonly timingMode: FramescaperImageTimingModeV1;
}

export interface OpenFramescaperImageFramePackRequestV1 {
	readonly source: FramescaperImageSourceV1;
	readonly read: (offset: number, length: number) => Awaitable<Uint8Array>;
	readonly assertCurrent?: () => Awaitable<void>;
	readonly signal?: AbortSignal;
}

export interface FramescaperImageFramePackReaderV1 {
	readonly version: 1;
	readonly source: FramescaperImageSourceV1;
	readonly receipt: Readonly<Record<string, unknown>>;
	readonly timings: readonly FramescaperImageFrameTimingV1[];
	readonly residentMetadataByteEstimate: number;
	readOriginal(signal?: AbortSignal): Promise<Uint8Array>;
	readFrame(index: number, signal?: AbortSignal): Promise<Uint8Array>;
	frameIndexAtTicks(sourceTicks: bigint): number;
}

const RECEIPT_RESIDENT_BYTE_MULTIPLIER = 32;
const INDEXED_FRAME_RESIDENT_BYTE_ESTIMATE = 2_048;

/** Conservative retained-object estimate used by bounded browser consumers. */
export function estimateFramescaperImageFramePackReaderMetadataBytesV1(
	receiptByteLength: number,
	frameCount: number,
): number {
	return checkedFramescaperImageAssetAdd(
		checkedFramescaperImageAssetMultiply(
			receiptByteLength, RECEIPT_RESIDENT_BYTE_MULTIPLIER, 'receipt resident bytes',
		),
		checkedFramescaperImageAssetMultiply(
			frameCount, INDEXED_FRAME_RESIDENT_BYTE_ESTIMATE, 'frame-index resident bytes',
		),
		'reader metadata resident bytes',
	);
}

/** Encode one original plus independently compressed canonical RGBA8 frames. */
export function createFramescaperImageFramePackV1(
	input: FramescaperImageFramePackInputV1,
): FramescaperImageFramePackPublicationV1 {
	const original = bytes(input?.original, 'The image original');
	if (original.byteLength < 1
		|| original.byteLength > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumOriginalBytes) {
		throw new FramescaperImageFramePackV1Error('The image original exceeds its byte domain.');
	}
	const width = positiveInteger(
		input?.width, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDimension, 'image width',
	);
	const height = positiveInteger(
		input?.height, FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDimension, 'image height',
	);
	const pixels = checkedFramescaperImageAssetMultiply(width, height, 'canonical pixel count');
	if (pixels > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumPixelsPerFrame) {
		throw new FramescaperImageFramePackV1Error('The canonical image exceeds its pixel ceiling.');
	}
	const rawByteLength = checkedFramescaperImageAssetMultiply(pixels, 4, 'canonical frame byte length');
	const timingMode = normalizeTimingMode(input?.timingMode);
	const receiptBytes = encodeFramescaperImageConversionReceiptV1(input?.receipt);
	const frameInputs = frameArray(input?.frames);
	let expectedPresentation = 0n;
	let totalRawBytes = 0;
	let hasAlpha = false;
	const encodedFrames: FramescaperImageEncodedFrameLayoutV1[] = frameInputs.map((frame, index) => {
		const normalized = frameInput(frame, index, rawByteLength, expectedPresentation);
		expectedPresentation += normalized.durationTicks;
		if (expectedPresentation > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)) {
			throw new FramescaperImageFramePackV1Error('The image frame timing exceeds 24 hours.');
		}
		totalRawBytes = checkedFramescaperImageAssetAdd(totalRawBytes, rawByteLength, 'decoded RGBA byte length');
		if (totalRawBytes > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumAssetBytes) {
			throw new FramescaperImageFramePackV1Error('The decoded RGBA frames exceed their byte ceiling.');
		}
		hasAlpha ||= validateCanonicalPixels(normalized.rgba);
		const compressed = zlibSync(normalized.rgba, { level: 9 });
		return Object.freeze({
			presentationTicks: normalized.presentationTicks,
			durationTicks: normalized.durationTicks,
			compressed,
			compressedSha256: digest(compressed),
			rawSha256: digest(normalized.rgba),
			rawByteLength,
		});
	});
	const sections = createFramescaperImageFramePackSectionsV1(
		original.byteLength, receiptBytes.byteLength, encodedFrames,
	);
	const totalByteLength = checkedFramescaperImageAssetAdd(
		sections.frameDataOffset, sections.frameDataByteLength, 'image asset byte length',
	);
	if (totalByteLength > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumAssetBytes) {
		throw new FramescaperImageFramePackV1Error('The image asset exceeds its byte ceiling.');
	}
	const originalSha256 = digest(original);
	const conversionReceiptSha256 = digest(receiptBytes);
	const output = new Uint8Array(totalByteLength);
	output.set(encodeFramescaperImageFramePackHeaderV1({
		sections,
		totalByteLength,
		width,
		height,
		frameCount: encodedFrames.length,
		durationTicks: expectedPresentation,
		timingMode,
		hasAlpha,
		originalSha256,
		conversionReceiptSha256,
	}));
	output.set(original, sections.originalOffset);
	output.set(receiptBytes, sections.receiptOffset);
	let frameOffset = sections.frameDataOffset;
	for (let index = 0; index < encodedFrames.length; index += 1) {
		const frame = encodedFrames[index]!;
		output.set(encodeFramescaperImageFramePackIndexV1(frame, frameOffset),
			sections.indexOffset + index * FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES);
		output.set(frame.compressed, frameOffset);
		frameOffset += frame.compressed.byteLength;
	}
	return Object.freeze({
		bytes: output,
		contentSha256: digest(output),
		assetByteLength: output.byteLength,
		originalSha256,
		originalByteLength: original.byteLength,
		conversionReceiptSha256,
		width,
		height,
		hasAlpha,
		frameCount: encodedFrames.length,
		durationTicks: expectedPresentation.toString(),
		timingMode,
	});
}

/** Authenticate the whole immutable body and its bounded sections before exposing a reader. */
export async function openFramescaperImageFramePackV1(
	request: OpenFramescaperImageFramePackRequestV1,
): Promise<FramescaperImageFramePackReaderV1> {
	const source = normalizeFramescaperImageSourceV1(request?.source);
	if (typeof request?.read !== 'function') {
		throw new FramescaperImageFramePackV1Error('An image frame-pack reader requires a range-read port.');
	}
	await current(request);
	const bodyDigest = sha256.create();
	for (let offset = 0; offset < source.assetByteLength;) {
		cancelled(request.signal);
		const length = Math.min(
			FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
			source.assetByteLength - offset,
		);
		bodyDigest.update(await readExact(request.read, offset, length));
		offset += length;
	}
	if (bytesToHex(bodyDigest.digest()) !== source.contentSha256) {
		throw new FramescaperImageFramePackV1Error('Image frame-pack bytes fail their complete body digest binding.');
	}
	await current(request);
	const headerBytes = await readExact(request.read, 0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES);
	const header = decodeFramescaperImageFramePackHeaderV1(headerBytes, source);
	await validateSectionDigest(
		request, header.originalOffset, header.originalByteLength, source.original.sha256, 'original',
	);
	const receiptBytes = await readSection(request.read, header.receiptOffset, header.receiptByteLength);
	if (digest(receiptBytes) !== source.conversionReceiptSha256) {
		throw new FramescaperImageFramePackV1Error('The image conversion receipt fails its digest binding.');
	}
	const receipt = decodeFramescaperImageConversionReceiptV1(receiptBytes);
	const indexBytes = await readSection(request.read, header.indexOffset, header.indexByteLength);
	const indexedFrames = decodeFramescaperImageFramePackIndexesV1(indexBytes, source, header);
	const residentMetadataByteEstimate = estimateFramescaperImageFramePackReaderMetadataBytesV1(
		header.receiptByteLength, indexedFrames.length,
	);
	await current(request);
	const timings = Object.freeze(indexedFrames.map(({ presentationTicks, durationTicks }) => (
		Object.freeze({ presentationTicks, durationTicks })
	)));
	return Object.freeze({
		version: 1,
		source,
		receipt,
		timings,
		residentMetadataByteEstimate,
		async readOriginal(signal?: AbortSignal): Promise<Uint8Array> {
			cancelled(signal);
			await current(request);
			const value = await readSection(request.read, header.originalOffset, header.originalByteLength, signal);
			if (digest(value) !== source.original.sha256) {
				throw new FramescaperImageFramePackV1Error('The image original changed after validation.');
			}
			await current(request);
			return value;
		},
		async readFrame(index: number, signal?: AbortSignal): Promise<Uint8Array> {
			if (!Number.isSafeInteger(index) || index < 0 || index >= indexedFrames.length) {
				throw new FramescaperImageFramePackV1Error('The image frame index is outside its closed domain.');
			}
			cancelled(signal);
			await current(request);
			const frame = indexedFrames[index]!;
			const compressed = await readSection(
				request.read, frame.offset, frame.compressedByteLength, signal,
			);
			if (digest(compressed) !== frame.compressedSha256) {
				throw new FramescaperImageFramePackV1Error('The image frame compressed digest is invalid.');
			}
			let rgba: Uint8Array;
			try {
				rgba = unzlibSync(compressed, { out: new Uint8Array(frame.rawByteLength + 1) });
			} catch (cause) {
				throw new FramescaperImageFramePackV1Error('The image frame zlib stream is invalid.', { cause });
			}
			if (rgba.byteLength !== frame.rawByteLength || digest(rgba) !== frame.rawSha256) {
				throw new FramescaperImageFramePackV1Error('The image frame raw length or digest is invalid.');
			}
			const frameHasAlpha = validateCanonicalPixels(rgba);
			if (!source.canonical.hasAlpha && frameHasAlpha) {
				throw new FramescaperImageFramePackV1Error('The image frame alpha disagrees with its persisted summary.');
			}
			await current(request);
			return rgba;
		},
		frameIndexAtTicks(sourceTicks: bigint): number {
			if (typeof sourceTicks !== 'bigint' || sourceTicks < 0n) {
				throw new FramescaperImageFramePackV1Error('Image source ticks must be a non-negative BigInt.');
			}
			let low = 0;
			let high = timings.length;
			while (low < high) {
				const middle = Math.floor((low + high) / 2);
				if (timings[middle]!.presentationTicks <= sourceTicks) low = middle + 1;
				else high = middle;
			}
			return Math.max(0, Math.min(timings.length - 1, low - 1));
		},
	});
}

function frameInput(
	value: unknown,
	index: number,
	rawByteLength: number,
	expectedPresentation: bigint,
): FramescaperImageFramePackFrameInputV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new FramescaperImageFramePackV1Error(`Image frame ${String(index)} must be an object.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== 3
		|| !data(descriptors.presentationTicks) || !data(descriptors.durationTicks) || !data(descriptors.rgba)) {
		throw new FramescaperImageFramePackV1Error(`Image frame ${String(index)} has unsupported fields.`);
	}
	const presentationTicks = tick(descriptors.presentationTicks.value, false, `frame ${String(index)} presentation`);
	const durationTicks = tick(descriptors.durationTicks.value, true, `frame ${String(index)} duration`);
	if (presentationTicks !== expectedPresentation) {
		throw new FramescaperImageFramePackV1Error('Image frame timing must be continuous from zero.');
	}
	const rgba = bytes(descriptors.rgba.value, `Image frame ${String(index)} RGBA`);
	if (rgba.byteLength !== rawByteLength) {
		throw new FramescaperImageFramePackV1Error(`Image frame ${String(index)} has an invalid RGBA byte length.`);
	}
	return Object.freeze({ presentationTicks, durationTicks, rgba });
}

function frameArray(value: unknown): readonly FramescaperImageFramePackFrameInputV1[] {
	if (!Array.isArray(value) || value.length < 1
		|| value.length > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumFrameCount) {
		throw new FramescaperImageFramePackV1Error('An image frame pack requires 1 through 4096 frames.');
	}
	return value;
}

function validateCanonicalPixels(rgba: Uint8Array): boolean {
	let hasAlpha = false;
	for (let offset = 0; offset < rgba.byteLength; offset += 4) {
		const alpha = rgba[offset + 3]!;
		hasAlpha ||= alpha !== 255;
		if (alpha === 0 && (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0)) {
			throw new FramescaperImageFramePackV1Error('Fully transparent canonical pixels must have zero RGB.');
		}
	}
	return hasAlpha;
}

async function validateSectionDigest(
	request: OpenFramescaperImageFramePackRequestV1,
	offset: number,
	length: number,
	expected: string,
	label: string,
): Promise<void> {
	const hasher = sha256.create();
	for (let consumed = 0; consumed < length;) {
		cancelled(request.signal);
		const chunkLength = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, length - consumed);
		hasher.update(await readExact(request.read, offset + consumed, chunkLength));
		consumed += chunkLength;
	}
	if (bytesToHex(hasher.digest()) !== expected) {
		throw new FramescaperImageFramePackV1Error(`The image ${label} section fails its digest binding.`);
	}
}

async function readSection(
	read: (offset: number, length: number) => Awaitable<Uint8Array>,
	offset: number,
	length: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const output = new Uint8Array(length);
	for (let consumed = 0; consumed < length;) {
		cancelled(signal);
		const chunkLength = Math.min(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, length - consumed);
		output.set(await readExact(read, offset + consumed, chunkLength), consumed);
		consumed += chunkLength;
	}
	return output;
}

async function readExact(
	read: (offset: number, length: number) => Awaitable<Uint8Array>,
	offset: number,
	length: number,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
		|| length > FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES) {
		throw new FramescaperImageFramePackV1Error('An image frame-pack range is outside its bounded domain.');
	}
	const value = await read(offset, length);
	if (!(value instanceof Uint8Array) || value.byteLength !== length) {
		throw new FramescaperImageFramePackV1Error('An image frame-pack range read was short or not exact bytes.');
	}
	return value;
}

function normalizeTimingMode(value: unknown): FramescaperImageTimingModeV1 {
	if (value !== 'embedded' && value !== 'fallback' && value !== 'mixed') {
		throw new FramescaperImageFramePackV1Error('The image timing mode is unsupported.');
	}
	return value;
}

function tick(value: unknown, positive: boolean, name: string): bigint {
	if (typeof value !== 'bigint' || value < (positive ? 1n : 0n)
		|| value > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)) {
		throw new FramescaperImageFramePackV1Error(`The image ${name} tick is outside its closed domain.`);
	}
	return value;
}

function bytes(value: unknown, name: string): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new FramescaperImageFramePackV1Error(`${name} must be bytes.`);
	return value;
}

function data(value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } {
	return Boolean(value && Object.hasOwn(value, 'value'));
}

function positiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
		throw new FramescaperImageFramePackV1Error(`The ${name} is outside its closed integer domain.`);
	}
	return value as number;
}

function digest(value: Uint8Array): string {
	return bytesToHex(sha256(value));
}

function cancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The image frame-pack operation was cancelled.', 'AbortError');
}

async function current(request: OpenFramescaperImageFramePackRequestV1): Promise<void> {
	cancelled(request.signal);
	await request.assertCurrent?.();
	cancelled(request.signal);
}

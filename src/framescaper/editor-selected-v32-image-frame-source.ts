/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from '../common/editor/sequence-frame-navigation.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import {
	estimateFramescaperImageFramePackReaderMetadataBytesV1,
	openFramescaperImageFramePackV1,
	type FramescaperImageFramePackReaderV1,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	decodeFramescaperImageFramePackHeaderV1,
	FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
} from '../common/editor/timeline-image-frame-pack-v1-layout.ts';
import {
	mapFramescaperImageTimelineFrameV1,
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';

export interface FramescaperStoredImageFrameV32 {
	readonly sourceTicks: bigint;
	readonly frameIndex: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

/** Narrow stored-body port whose arrayBuffer result is transferred into V32 reader custody. */
export interface FramescaperStoredImageAssetStoreV32 {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
}

/** Own one body snapshot and authenticate its complete frame-pack graph before use. */
export async function openFramescaperStoredImageFramePackV32(
	store: FramescaperStoredImageAssetStoreV32,
	sourceValue: unknown,
	signal?: AbortSignal,
	admitResidentMetadata?: (byteLength: number) => void,
): Promise<FramescaperImageFramePackReaderV1> {
	if (!store || typeof store.loadMediaAsset !== 'function') {
		throw new TypeError('V32 image preview requires an AudioEditorProjectStore.');
	}
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	throwIfAborted(signal);
	const body = await store.loadMediaAsset(source.storageKey, { ...(signal ? { signal } : {}) });
	throwIfAborted(signal);
	if (!body || body.size !== source.assetByteLength
		|| typeof body.slice !== 'function' || typeof body.arrayBuffer !== 'function') {
		throw new Error(`V32 image frame pack ${source.id} is unavailable or has the wrong byte length.`);
	}
	const loaded = await body.arrayBuffer();
	throwIfAborted(signal);
	if (!(loaded instanceof ArrayBuffer) || loaded.byteLength !== source.assetByteLength) {
		throw new Error(`V32 image frame pack ${source.id} changed while its body was snapshotted.`);
	}
	const snapshot = new Uint8Array(
		structuredClone(loaded, { transfer: [loaded] }),
	) as Uint8Array<ArrayBuffer>;
	const header = decodeFramescaperImageFramePackHeaderV1(
		snapshot.subarray(0, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES), source,
	);
	const metadataByteEstimate = estimateFramescaperImageFramePackReaderMetadataBytesV1(
		header.receiptByteLength, source.canonical.frameCount,
	);
	admitResidentMetadata?.(metadataByteEstimate);
	const reader = await openFramescaperImageFramePackV1({
		source,
		signal,
		read(offset, length) {
			throwIfAborted(signal);
			return Promise.resolve(snapshot.slice(offset, offset + length));
		},
	});
	if (reader.residentMetadataByteEstimate !== metadataByteEstimate) {
		throw new Error(`V32 image frame pack ${source.id} changed its reader metadata estimate.`);
	}
	return reader;
}

/** Resolve one runtime sample through the exact sequence grid and packed tick table. */
export async function readFramescaperStoredImageFrameAtSampleV32(
	reader: FramescaperImageFramePackReaderV1,
	clipValue: unknown,
	timelineSample: number,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
	sampleRate: number,
	signal?: AbortSignal,
): Promise<FramescaperStoredImageFrameV32> {
	const address = mapFramescaperImageFrameAtSampleV32(
		reader, clipValue, timelineSample, sequenceRate, sampleRate,
	);
	return Object.freeze({
		...address,
		pixels: await reader.readFrame(address.frameIndex, signal) as Uint8Array<ArrayBuffer>,
	});
}

/** Synchronous address resolution for a preloaded preview session. */
export function mapFramescaperImageFrameAtSampleV32(
	reader: FramescaperImageFramePackReaderV1,
	clipValue: unknown,
	timelineSample: number,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
	sampleRate: number,
): Readonly<{ readonly sourceTicks: bigint; readonly frameIndex: number }> {
	const clip = normalizeFramescaperImageClipV1(clipValue);
	const sequenceFrame = sequenceFrameAtSample(timelineSample, sequenceRate, sampleRate);
	return mapFramescaperImageTimelineFrameV1({
		clip,
		sequenceFrame,
		sequenceRate,
		timings: reader.timings,
	});
}

/** Deterministic nearest-neighbour RGBA resize shared by bin and filmstrip pictures. */
export function scaleFramescaperImageRgbaV32(
	pixelsValue: Uint8Array,
	sourceWidthValue: number,
	sourceHeightValue: number,
	targetWidthValue: number,
	targetHeightValue: number,
	signal?: AbortSignal,
): Uint8Array<ArrayBuffer> {
	const sourceWidth = dimension(sourceWidthValue, 'V32 image source width');
	const sourceHeight = dimension(sourceHeightValue, 'V32 image source height');
	const targetWidth = dimension(targetWidthValue, 'V32 image target width');
	const targetHeight = dimension(targetHeightValue, 'V32 image target height');
	if (targetWidth * targetHeight > 33_554_432) {
		throw new RangeError('A V32 image preview frame may contain at most 33554432 pixels.');
	}
	if (!(pixelsValue instanceof Uint8Array)
		|| pixelsValue.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('V32 image RGBA bytes do not match their canonical dimensions.');
	}
	throwIfAborted(signal);
	if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
		return pixelsValue.slice() as Uint8Array<ArrayBuffer>;
	}
	const output = new Uint8Array(targetWidth * targetHeight * 4);
	for (let y = 0; y < targetHeight; y += 1) {
		throwIfAborted(signal);
		const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
		for (let x = 0; x < targetWidth; x += 1) {
			const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth));
			const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
			output.set(pixelsValue.subarray(sourceOffset, sourceOffset + 4), (y * targetWidth + x) * 4);
		}
	}
	return output;
}

export function fitFramescaperImagePreviewSizeV32(
	source: FramescaperImageSourceV1,
	maximumWidthValue: number,
	maximumHeightValue: number,
): Readonly<{ readonly width: number; readonly height: number }> {
	const canonical = normalizeFramescaperImageSourceV1(source).canonical;
	const maximumWidth = dimension(maximumWidthValue, 'V32 image preview width');
	const maximumHeight = dimension(maximumHeightValue, 'V32 image preview height');
	const scale = Math.min(1, maximumWidth / canonical.width, maximumHeight / canonical.height);
	return Object.freeze({
		width: Math.max(1, Math.round(canonical.width * scale)),
		height: Math.max(1, Math.round(canonical.height * scale)),
	});
}

export function framescaperImageSourceForClipV32(
	sources: readonly unknown[],
	clipValue: unknown,
): FramescaperImageSourceV1 {
	const clip = normalizeFramescaperImageClipV1(clipValue);
	const source = sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate)
		&& (candidate as Readonly<Record<string, unknown>>).id === clip.sourceId
	));
	if (source === undefined) throw new ReferenceError(`V32 image source ${clip.sourceId} is unavailable.`);
	const normalized = normalizeFramescaperImageSourceV1(source);
	if (normalized.id !== clip.sourceId) throw new ReferenceError('V32 image clip changed source authority.');
	return normalized;
}

export function throwIfFramescaperImagePreviewAbortedV32(signal?: AbortSignal): void {
	throwIfAborted(signal);
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason ?? new DOMException('The V32 image preview was aborted.', 'AbortError');
	}
}

export type {
	FramescaperImageClipV1,
	FramescaperImageFramePackReaderV1,
	FramescaperImageSourceV1,
};

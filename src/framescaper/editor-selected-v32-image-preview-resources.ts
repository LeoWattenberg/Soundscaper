/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	estimateFramescaperImageFramePackReaderMetadataBytesV1,
	FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	normalizeFramescaperImageSourceV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';

/** V32 image-route ceiling; inherited V27 media keeps independent resource ownership. */
export const FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_WORKING_BYTES_V32 = 512 * 1024 * 1024;
export const FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_SOURCES_V32 = 512;
export const FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32 = 4_096;

export interface FramescaperImagePreviewResourceContextV32 {
	readonly source: FramescaperImageSourceV1;
	readonly width: number;
	readonly height: number;
}

export interface FramescaperImagePreviewResourceBudgetV32 {
	readonly sourceCount: number;
	readonly contextCount: number;
	readonly snapshotBytes: bigint;
	readonly readerMetadataBytes: bigint;
	readonly retainedFrameBytes: bigint;
	readonly drawableBackingBytes: bigint;
	readonly requestOutputBytes: bigint;
	readonly uniqueFrameCacheBytes: bigint;
	readonly transientRangeBytes: bigint;
	readonly transientRawFrameBytes: bigint;
	readonly transientScaledFrameBytes: bigint;
	readonly totalBytes: bigint;
}

/**
 * Admit the eager image-preview representation required by the synchronous
 * preview-session resolve contract. Every canonical frame is retained at its
 * fitted size, while each clip owns an independently backed drawable.
 */
export function admitFramescaperImageTimelinePreviewResourcesV32(
	contexts: readonly FramescaperImagePreviewResourceContextV32[],
): FramescaperImagePreviewResourceBudgetV32 {
	const admitted = contextsAndSources(contexts, 'timeline preview');
	let retainedFrameBytes = 0n;
	for (const context of admitted.sources.values()) {
		retainedFrameBytes += scaledFrameBytes(context)
			* BigInt(context.source.canonical.frameCount);
	}
	let drawableBackingBytes = 0n;
	for (const context of admitted.contexts) drawableBackingBytes += scaledFrameBytes(context);
	return admit('timeline preview', admitted, {
		retainedFrameBytes,
		drawableBackingBytes,
		requestOutputBytes: 0n,
		uniqueFrameCacheBytes: 0n,
		transientScaledFrameBytes: maximum(admitted.contexts.map(scaledFrameBytes)),
	});
}

/** Admit one Project Bin output plus the reader's worst simultaneous decode. */
export function admitFramescaperImageProjectBinThumbnailResourcesV32(
	sourceValue: FramescaperImageSourceV1,
	width: number,
	height: number,
): FramescaperImagePreviewResourceBudgetV32 {
	const admitted = contextsAndSources([{ source: sourceValue, width, height }], 'Project Bin thumbnail');
	return admit('Project Bin thumbnail', admitted, {
		retainedFrameBytes: 0n,
		drawableBackingBytes: 0n,
		requestOutputBytes: scaledFrameBytes(admitted.contexts[0]!),
		uniqueFrameCacheBytes: 0n,
		transientScaledFrameBytes: 0n,
	});
}

/**
 * Admit every requested filmstrip output and a conservative unique-frame cache.
 * Frame indexes require authenticated pack timings, so preflight treats every
 * request as a distinct cache entry in order to finish before the first read.
 */
export function admitFramescaperImageTimelineFilmstripResourcesV32(
	contexts: readonly FramescaperImagePreviewResourceContextV32[],
): FramescaperImagePreviewResourceBudgetV32 {
	const admitted = contextsAndSources(contexts, 'timeline filmstrip');
	let requestOutputBytes = 0n;
	for (const context of admitted.contexts) requestOutputBytes += scaledFrameBytes(context);
	return admit('timeline filmstrip', admitted, {
		retainedFrameBytes: 0n,
		drawableBackingBytes: 0n,
		requestOutputBytes,
		uniqueFrameCacheBytes: requestOutputBytes,
		transientScaledFrameBytes: 0n,
	});
}

/** Bind an authenticated reader's exact estimate to its conservative preflight reservation. */
export function assertFramescaperImagePreviewReaderMetadataV32(
	sourceValue: FramescaperImageSourceV1,
	byteLength: number,
): void {
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	if (!Number.isSafeInteger(byteLength) || byteLength < 0
		|| byteLength > conservativeReaderMetadataBytes(source)) {
		throw new RangeError(`V32 image reader ${source.id} exceeds its preflight metadata reservation.`);
	}
}

interface AdmittedContextsV32 {
	readonly contexts: readonly FramescaperImagePreviewResourceContextV32[];
	readonly sources: ReadonlyMap<string, FramescaperImagePreviewResourceContextV32>;
}

interface RouteResourcesV32 {
	readonly retainedFrameBytes: bigint;
	readonly drawableBackingBytes: bigint;
	readonly requestOutputBytes: bigint;
	readonly uniqueFrameCacheBytes: bigint;
	readonly transientScaledFrameBytes: bigint;
}

function contextsAndSources(
	values: readonly FramescaperImagePreviewResourceContextV32[],
	route: string,
): AdmittedContextsV32 {
	if (!Array.isArray(values) || values.length > FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_CONTEXTS_V32) {
		throw new RangeError(`V32 image ${route} exceeds its context count bound.`);
	}
	const contexts = values.map((value) => Object.freeze({
		source: normalizeFramescaperImageSourceV1(value?.source),
		width: dimension(value?.width, `V32 image ${route} width`),
		height: dimension(value?.height, `V32 image ${route} height`),
	}));
	const sources = new Map<string, FramescaperImagePreviewResourceContextV32>();
	for (const context of contexts) {
		const prior = sources.get(context.source.id);
		if (prior && (prior.width !== context.width || prior.height !== context.height)) {
			throw new RangeError(`V32 image ${route} source geometry is ambiguous.`);
		}
		sources.set(context.source.id, context);
	}
	if (sources.size > FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_SOURCES_V32) {
		throw new RangeError(`V32 image ${route} exceeds its source count bound.`);
	}
	return Object.freeze({ contexts: Object.freeze(contexts), sources });
}

function admit(
	route: string,
	admitted: AdmittedContextsV32,
	resources: RouteResourcesV32,
): FramescaperImagePreviewResourceBudgetV32 {
	let snapshotBytes = 0n;
	let readerMetadataBytes = 0n;
	let maximumAssetBytes = 0n;
	let maximumRawFrameBytes = 0n;
	for (const { source } of admitted.sources.values()) {
		const assetBytes = BigInt(source.assetByteLength);
		snapshotBytes += assetBytes;
		readerMetadataBytes += BigInt(conservativeReaderMetadataBytes(source));
		maximumAssetBytes = maximumBigInt(maximumAssetBytes, assetBytes);
		maximumRawFrameBytes = maximumBigInt(maximumRawFrameBytes, rawFrameBytes(source) + 1n);
	}
	const transientRangeBytes = maximumAssetBytes === 0n ? 0n
		: maximumAssetBytes + minimumBigInt(
			maximumAssetBytes, BigInt(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES),
		);
	const totalBytes = snapshotBytes + readerMetadataBytes
		+ resources.retainedFrameBytes + resources.drawableBackingBytes
		+ resources.requestOutputBytes + resources.uniqueFrameCacheBytes
		+ transientRangeBytes + maximumRawFrameBytes + resources.transientScaledFrameBytes;
	if (totalBytes > BigInt(FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_WORKING_BYTES_V32)) {
		throw new RangeError(`V32 image ${route} exceeds its 512 MiB working byte bound.`);
	}
	return Object.freeze({
		sourceCount: admitted.sources.size,
		contextCount: admitted.contexts.length,
		snapshotBytes,
		readerMetadataBytes,
		retainedFrameBytes: resources.retainedFrameBytes,
		drawableBackingBytes: resources.drawableBackingBytes,
		requestOutputBytes: resources.requestOutputBytes,
		uniqueFrameCacheBytes: resources.uniqueFrameCacheBytes,
		transientRangeBytes,
		transientRawFrameBytes: maximumRawFrameBytes,
		transientScaledFrameBytes: resources.transientScaledFrameBytes,
		totalBytes,
	});
}

function conservativeReaderMetadataBytes(source: FramescaperImageSourceV1): number {
	const indexBytes = source.canonical.frameCount * FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES;
	const fixedBytes = FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES
		+ source.original.byteLength + indexBytes + source.canonical.frameCount;
	const availableReceiptBytes = source.assetByteLength - fixedBytes;
	if (availableReceiptBytes < 2) {
		throw new RangeError(`V32 image source ${source.id} cannot contain a canonical frame pack.`);
	}
	return estimateFramescaperImageFramePackReaderMetadataBytesV1(
		Math.min(availableReceiptBytes, FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES),
		source.canonical.frameCount,
	);
}

function rawFrameBytes(source: FramescaperImageSourceV1): bigint {
	return BigInt(source.canonical.width) * BigInt(source.canonical.height) * 4n;
}

function scaledFrameBytes(context: FramescaperImagePreviewResourceContextV32): bigint {
	return BigInt(context.width) * BigInt(context.height) * 4n;
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function maximum(values: readonly bigint[]): bigint {
	return values.reduce(maximumBigInt, 0n);
}

function maximumBigInt(left: bigint, right: bigint): bigint {
	return left > right ? left : right;
}

function minimumBigInt(left: bigint, right: bigint): bigint {
	return left < right ? left : right;
}

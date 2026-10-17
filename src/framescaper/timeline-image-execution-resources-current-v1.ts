/* SPDX-License-Identifier: AGPL-3.0-only */
import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import { FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES } from '../common/editor/timeline-image-frame-pack-v1.ts';
import type { FramescaperImageClipV1 } from '../common/editor/timeline-image-model.ts';
import type { FramescaperCurrentImageSourceTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import { framescaperEditableImageWorkingBytes } from './timeline-image-current-frame-source.ts';
import { FRAMESCAPER_RAW_IMAGE_WORKING_BYTES_CURRENT_V1 } from './internal/timeline-image-raw-working-plan-current-v1.ts';

const MAXIMUM_ACTIVE_IMAGE_ASSETS = 512;
const MAXIMUM_ACTIVE_IMAGE_ASSET_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ACTIVE_IMAGE_CONTEXTS = 4_096;
const MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES = 512 * 1024 * 1024;

export interface ImageExecutionResourcesTimelineImage {
	readonly maximumAssetBytes: bigint;
	readonly snapshotBytes: bigint;
	readonly recipeWorkingBytes: bigint;
	readonly maximumWorkingBytes: bigint;
	readonly readerMetadataBytes: bigint;
}

export type ImageExecutionBaseResourcesTimelineImage = Omit<ImageExecutionResourcesTimelineImage, 'readerMetadataBytes'>;

export async function admitActiveImageAssets(sources: readonly FramescaperCurrentImageSourceTimelineImage[], options: FileSizeWarningOptions): Promise<void> {
	const unique = new Map(sources.map((source) => [source.id, source] as const));
	if (unique.size > MAXIMUM_ACTIVE_IMAGE_ASSETS) {
		throw new RangeError('timelineImage active image assets exceed their count bound.');
	}
	let total = 0n;
	for (const source of unique.values()) total += BigInt(source.assetByteLength);
	if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('timelineImage active image assets exceed the supported byte count.');
	await confirmFileSizeWarning(Number(total), MAXIMUM_ACTIVE_IMAGE_ASSET_BYTES, 'Video export image assets', options);
}

export async function admitImageExecutionResources(
	planned: readonly Readonly<{
		readonly clip: FramescaperImageClipV1;
		readonly source: FramescaperCurrentImageSourceTimelineImage;
	}>[],
	options: FileSizeWarningOptions,
): Promise<ImageExecutionBaseResourcesTimelineImage> {
	if (planned.length > MAXIMUM_ACTIVE_IMAGE_CONTEXTS) {
		throw new RangeError('timelineImage active image clips exceed their context bound.');
	}
	const sources = new Map<string, FramescaperCurrentImageSourceTimelineImage>();
	for (const { source } of planned) sources.set(source.id, source);
	let snapshotBytes = 0n;
	let maximumAssetBytes = 0n, recipeWorkingBytes = 0n;
	for (const source of sources.values()) {
		const assetBytes = BigInt(source.assetByteLength);
		snapshotBytes += assetBytes;
		maximumAssetBytes = maximumBigInt(maximumAssetBytes, assetBytes);
		recipeWorkingBytes = maximumBigInt(recipeWorkingBytes, framescaperEditableImageWorkingBytes(source));
	}
	const nativeRaw = [...sources.values()].some(source => source.schemaVersion === 4 || source.schemaVersion === 5);
	const maximum = BigInt(nativeRaw ? FRAMESCAPER_RAW_IMAGE_WORKING_BYTES_CURRENT_V1 : MAXIMUM_IMAGE_EXECUTION_WORKING_BYTES);
	const inputBytes = snapshotBytes + maximumAssetBytes + rangeReadChunkBytes();
	if (recipeWorkingBytes && inputBytes + recipeWorkingBytes > maximum) throw new RangeError('Editable image recipe exceeds its export working byte bound.');
	await confirmFileSizeWarning(Number(inputBytes), Number(maximum), 'Video export image snapshots', options);
	// Confirmed large input snapshots keep the frame and decoder workspace budget.
	const maximumWorkingBytes = inputBytes > maximum ? inputBytes + maximum : maximum;
	return Object.freeze({ maximumAssetBytes, snapshotBytes, recipeWorkingBytes, maximumWorkingBytes });
}

function rangeReadChunkBytes(): bigint { return BigInt(FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES); }
function maximumBigInt(left: bigint, right: bigint): bigint { return left > right ? left : right; }

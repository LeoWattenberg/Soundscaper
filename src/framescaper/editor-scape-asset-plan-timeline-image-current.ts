/* SPDX-License-Identifier: AGPL-3.0-only */
import { framescaperImageSourceResourceReferencesCurrentV1 } from '../common/editor/timeline-image-model-current-v1.ts';
import { planFramescaperMaskRasterArchiveAssetsV1, validateFramescaperMaskRasterArchiveAssetsV1 } from './timeline-image-mask-raster-assets-v1.ts';
import type { ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { collectFramescaperScapeAssetReferencesFinishing } from './editor-scape-asset-plan-finishing.ts';
import { collectFramescaperDurableScapeAssetReferences, planFramescaperDurableScapeExportAssets,
	validateFramescaperDurableScapeImportAssets, type FramescaperDurableScapeMetadataStore } from '../common/editor/scape-durable-asset-plan-core-v1.ts';
import { planFramescaperScapeImageExportAssetsTimelineImage, validateFramescaperScapeImageImportAssetsTimelineImage } from './editor-scape-asset-plan-timeline-image.ts';
import type { FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import { framescaperImagePackSourceCurrentV1 } from '../common/editor/timeline-image-pack-source-current-v1.ts';
import { normalizeFramescaperImageSourceV4 } from '../common/editor/timeline-image-model-v4.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from '../common/editor/timeline-image-raw-original-plan-current-v1.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';

/** A private pack-only delegate retains the exact V1 archive body/timing
 * contract. The complete selected project, including recipe and provenance,
 * remains the separately authenticated archive document. */
export function timelineImageArchivePackProjection(project: FramescaperProjectTimelineImage): FramescaperProjectTimelineImage {
	return { ...project, sources: project.sources.map(source => {
		if (source.kind !== 'image' || source.schemaVersion === 1) return source;
		return framescaperImagePackSourceCurrentV1(source) as FramescaperProjectTimelineImage['sources'][number];
	}) };
}

/** Every selected recipe resource is durable, including disabled effects. */
function durableReferences(project: FramescaperProjectTimelineImage) {
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(framescaperProjectNativeMediaFoundationShapeTimelineImage(project));
	const recipeLuts = project.sources.flatMap(source => source.kind === 'image' && source.schemaVersion !== 1
		? framescaperImageSourceResourceReferencesCurrentV1(source).luts : []);
	const extra = collectFramescaperDurableScapeAssetReferences({ sources: [], freezeRenderedSourceIds: new Set(),
		luts: () => recipeLuts, processorStacks: () => [], motionAnalyses: () => [] }, 'finishing');
	const all = [...collectFramescaperScapeAssetReferencesFinishing(foundation), ...extra];
	const references: typeof all = [], ids = new Map<string, typeof all[number]>(), entries = new Map<string, typeof all[number]>(), keys = new Map<string, typeof all[number]>();
	for (const row of all) {
		const previous = [ids.get(row.archiveId), entries.get(row.entry), keys.get(row.storageKey)].filter(value => value !== undefined);
		if (previous.length) {
			if (previous.every(value => JSON.stringify(value) === JSON.stringify(row))) continue;
			throw new Error('Current timeline image archive resources have conflicting identities.');
		}
		references.push(row); ids.set(row.archiveId, row); entries.set(row.entry, row); keys.set(row.storageKey, row);
	}
	return Object.freeze(references);
}

export async function planTimelineImageCurrentArchiveAssets(project: FramescaperProjectTimelineImage,
	store: FramescaperDurableScapeMetadataStore, signal?: AbortSignal, warningOptions: FileSizeWarningOptions = {}) {
	for (const source of project.sources) if (source.kind === 'image' && source.schemaVersion === 4) assertRawPackBudget(source);
	// Sequential ownership avoids publishing/rejecting while an independent
	// metadata read still belongs to the same archive operation.
	const durable = await planFramescaperDurableScapeExportAssets(durableReferences(project), store, 'finishing', signal, warningOptions);
	const images = (await planFramescaperScapeImageExportAssetsTimelineImage(timelineImageArchivePackProjection(project), store, signal)).map(asset => {
		const source = project.sources.find(source => source.kind === 'image' && source.storageKey === asset.storageKey);
		return source?.kind === 'image' && source.schemaVersion === 4 ? Object.freeze({ ...asset, source: Object.freeze({ ...asset.source, rawImageSource: source }) }) : asset;
	});
	const masks = await planFramescaperMaskRasterArchiveAssetsV1(project, store, signal);
	return Object.freeze([...durable, ...images, ...masks]);
}

/** The full Source4 document remains authoritative beside its exact immutable
 * pack projection. No cached byte frame grants native Original equality. */
export async function validateFramescaperRawImageAssetBodyCurrentV1(value: unknown, bodyValue: unknown, signal?: AbortSignal): Promise<void> {
	const source = normalizeFramescaperImageSourceV4(value), body = canonicalMediaContentBlob(bodyValue);
	assertRawPackBudget(source);
	const size = Number(Reflect.apply(Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, body, []));
	if (size !== source.assetByteLength) throw new RangeError('Frame RAW archive body differs from its exact native size.');
	const slice = Blob.prototype.slice, read = Blob.prototype.arrayBuffer;
	const { withFramescaperRawImageOriginalCurrentV1 } = await import('../common/editor/timeline-image-raw-pack-current-v1.ts');
	await withFramescaperRawImageOriginalCurrentV1({ source, ...(signal ? { signal } : {}), read: async (offset, length) =>
		new Uint8Array(await Reflect.apply(read, Reflect.apply(slice, body, [offset, offset + length]) as Blob, []) as ArrayBuffer) }, () => undefined);
}

function assertRawPackBudget(source: unknown): void {
	const plan = prepareFramescaperRawImageOriginalCurrentV1(source);
	if (BigInt(plan.source.assetByteLength) * 3n + plan.decodeWorkingBytes > 1024n * 1024n * 1024n) throw new RangeError('Frame RAW archive pack and decode exceed their 1 GiB working bound.');
}

export function validateTimelineImageCurrentArchiveAssets(project: FramescaperProjectTimelineImage, manifest: ScapeManifest) {
	// Admission precedes inherited staging and its generic receipt parser.
	// Source4 binds that receipt to the exact native declaration and reserves
	// pack retention plus the decoder maximum before any writer or body read.
	for (const source of project.sources) if (source.kind === 'image' && source.schemaVersion === 4) assertRawPackBudget(source);
	return Object.freeze({ foundation: validateFramescaperDurableScapeImportAssets(durableReferences(project), manifest, 'finishing'),
		images: validateFramescaperScapeImageImportAssetsTimelineImage(timelineImageArchivePackProjection(project), manifest),
		masks: validateFramescaperMaskRasterArchiveAssetsV1(project, manifest) });
}

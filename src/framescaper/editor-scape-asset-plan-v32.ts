/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeOperation, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import { safeScapeEntryId } from '../common/editor/scape-archive-media.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { openFramescaperImageFramePackV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';
import type { FramescaperProjectV32 } from './editor-project-v32.ts';

export const FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V32 = 'framescaper-image-asset' as const;
export const FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V32 = 'framescaper-image-asset-v1' as const;

export interface FramescaperScapeImageAssetReferenceV32 {
	readonly source: FramescaperImageSourceV1;
	readonly sourceId: string;
	readonly archiveId: string;
	readonly kind: typeof FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V32;
	readonly encoding: typeof FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V32;
	readonly entry: string;
	readonly mimeType: typeof FRAMESCAPER_IMAGE_ASSET_MIME_TYPE;
	readonly storageKey: string;
	readonly sha256: string;
	readonly byteLength: number;
}

export interface FramescaperScapeImageImportValidationV32 {
	readonly references: readonly FramescaperScapeImageAssetReferenceV32[];
	readonly descriptorByArchiveId: ReadonlyMap<string, ScapeAssetDescriptor>;
}

interface MetadataStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<unknown> | unknown;
}

/** Plan every V32 image source as one exact immutable archive body. */
export async function planFramescaperScapeImageExportAssetsV32(
	project: FramescaperProjectV32,
	store: MetadataStore,
	signal?: AbortSignal,
): Promise<readonly PlannedScapeExportAsset[]> {
	const assets: PlannedScapeExportAsset[] = [];
	for (const reference of collectFramescaperScapeImageAssetReferencesV32(project)) {
		throwIfScapeAborted(signal);
		const metadata = record(
			await awaitScapeOperation(store.getMediaAssetMetadata(reference.storageKey), signal),
			`V32 image ${reference.sourceId} metadata`,
		);
		assertImageMetadata(metadata, reference);
		assets.push(Object.freeze({
			source: Object.freeze({
				name: reference.source.name,
				imageAssetReference: reference,
			}),
			sourceId: reference.archiveId,
			storageKey: reference.storageKey,
			kind: reference.kind,
			entry: reference.entry,
			encoding: reference.encoding,
			mimeType: reference.mimeType,
			size: reference.byteLength,
			expectedSha256: reference.sha256,
		}));
	}
	return Object.freeze(assets);
}

/** Admit an archive manifest only when it exactly closes over V32 image authority. */
export function validateFramescaperScapeImageImportAssetsV32(
	project: FramescaperProjectV32,
	manifest: ScapeManifest,
): Readonly<FramescaperScapeImageImportValidationV32> {
	const references = collectFramescaperScapeImageAssetReferencesV32(project);
	const descriptors = manifest.assets.filter(({ kind }) => kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V32);
	if (descriptors.length !== references.length) {
		throw new Error('The V32 Scape archive has an incomplete image asset inventory.');
	}
	const descriptorByArchiveId = new Map<string, ScapeAssetDescriptor>();
	for (const descriptor of descriptors) {
		if (descriptorByArchiveId.has(descriptor.sourceId)) {
			throw new Error(`The V32 Scape image asset ${descriptor.sourceId} is duplicated.`);
		}
		descriptorByArchiveId.set(descriptor.sourceId, descriptor);
	}
	for (const reference of references) {
		const descriptor = descriptorByArchiveId.get(reference.archiveId);
		if (!descriptor || descriptor.kind !== reference.kind || descriptor.entry !== reference.entry
			|| descriptor.encoding !== reference.encoding || descriptor.mimeType !== reference.mimeType
			|| descriptor.size !== reference.byteLength || descriptor.sha256 !== reference.sha256) {
			throw new Error(`The V32 Scape image descriptor for ${reference.sourceId} conflicts with project authority.`);
		}
	}
	return Object.freeze({ references, descriptorByArchiveId });
}

/** Verify both the outer content binding and every independently compressed canonical frame. */
export async function validateFramescaperImageAssetBodyV32(
	sourceValue: unknown,
	bodyValue: unknown,
	signal?: AbortSignal,
): Promise<Blob> {
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	const body = canonicalMediaContentBlob(bodyValue);
	if (body.size !== source.assetByteLength) {
		throw new Error(`V32 image body ${source.storageKey} has a conflicting size.`);
	}
	const reader = await openFramescaperImageFramePackV1({
		source,
		read: async (offset, length) => new Uint8Array(await body.slice(offset, offset + length).arrayBuffer()),
		...(signal ? { signal } : {}),
	});
	for (let index = 0; index < source.canonical.frameCount; index += 1) {
		throwIfScapeAborted(signal);
		await reader.readFrame(index, signal);
	}
	return body;
}

export async function validateFramescaperScapeImageExportAssetBodyV32(
	asset: PlannedScapeExportAsset,
	body: Blob,
	signal?: AbortSignal,
): Promise<void> {
	const reference = plannedReference(asset);
	if (body.size !== asset.size) throw new Error('The V32 Scape image body changed size after admission.');
	await validateFramescaperImageAssetBodyV32(reference.source, body, signal);
}

export function collectFramescaperScapeImageAssetReferencesV32(
	project: FramescaperProjectV32,
): readonly FramescaperScapeImageAssetReferenceV32[] {
	const references: FramescaperScapeImageAssetReferenceV32[] = [];
	const archiveIds = new Set<string>();
	const entries = new Set<string>();
	const storageKeys = new Set<string>();
	for (const value of project.sources) {
		if (value.kind !== 'image') continue;
		const source = normalizeFramescaperImageSourceV1(value);
		const reference = imageReference(source);
		if (archiveIds.has(reference.archiveId) || entries.has(reference.entry)
			|| storageKeys.has(reference.storageKey)) {
			throw new Error(`The V32 Scape image ${source.id} has a conflicting archive identity.`);
		}
		archiveIds.add(reference.archiveId);
		entries.add(reference.entry);
		storageKeys.add(reference.storageKey);
		references.push(reference);
	}
	return Object.freeze(references);
}

function imageReference(source: FramescaperImageSourceV1): FramescaperScapeImageAssetReferenceV32 {
	return Object.freeze({
		source,
		sourceId: source.id,
		archiveId: `framescaper-v32:image:${source.id}`,
		kind: FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V32,
		encoding: FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V32,
		entry: `framescaper/v32/image/${safeScapeEntryId(source.id)}/body`,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: source.storageKey,
		sha256: source.contentSha256,
		byteLength: source.assetByteLength,
	});
}

function plannedReference(asset: PlannedScapeExportAsset): FramescaperScapeImageAssetReferenceV32 {
	const source = record(asset.source, 'V32 planned image archive source');
	const candidate = record(source.imageAssetReference, 'V32 planned image archive reference');
	const imageSource = normalizeFramescaperImageSourceV1(candidate.source);
	const expected = imageReference(imageSource);
	if (JSON.stringify(candidate) !== JSON.stringify(expected)
		|| asset.sourceId !== expected.archiveId || asset.storageKey !== expected.storageKey
		|| asset.kind !== expected.kind || asset.entry !== expected.entry
		|| asset.encoding !== expected.encoding || asset.mimeType !== expected.mimeType
		|| asset.size !== expected.byteLength || asset.expectedSha256 !== expected.sha256) {
		throw new Error('The V32 planned image archive asset drifted from its exact reference.');
	}
	return expected;
}

function assertImageMetadata(
	metadata: Record<string, unknown>,
	reference: FramescaperScapeImageAssetReferenceV32,
): void {
	if (metadata.sourceId !== reference.storageKey || metadata.size !== reference.byteLength
		|| metadata.sha256 !== reference.sha256
		|| (metadata.mimeType !== undefined && metadata.mimeType !== ''
			&& metadata.mimeType !== reference.mimeType)
		|| (metadata.kind !== undefined && metadata.kind !== '' && metadata.kind !== 'timeline-image')
		|| (metadata.encoding !== undefined && metadata.encoding !== ''
			&& metadata.encoding !== reference.encoding)) {
		throw new Error(`V32 image body ${reference.storageKey} is missing or stale.`);
	}
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Record<string, unknown>;
}

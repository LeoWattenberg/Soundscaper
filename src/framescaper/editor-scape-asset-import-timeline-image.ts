/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { verifyScapeExtractedAsset } from '../common/editor/scape-archive-media.ts';
import {
	extractScapeVideo,
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter,
} from '../common/editor/scape-archive-video.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../common/editor/scape-project-asset-extension.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-contract.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { stageFramescaperScapeImportAssetsFinishing } from './editor-scape-asset-import-finishing.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_TIMELINE_IMAGE,
	collectFramescaperScapeImageAssetReferencesTimelineImage,
	validateFramescaperImageAssetBodyTimelineImage,
	validateFramescaperScapeImageImportAssetsTimelineImage,
	type FramescaperScapeImageAssetReferenceTimelineImage,
	type FramescaperScapeImageImportValidationTimelineImage,
} from './editor-scape-asset-plan-timeline-image.ts';
import type { FramescaperScapeImportValidationFinishing } from './editor-scape-asset-plan-finishing.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';

export interface FramescaperScapeImportValidationTimelineImage {
	readonly foundation: Readonly<FramescaperScapeImportValidationFinishing>;
	readonly images: Readonly<FramescaperScapeImageImportValidationTimelineImage>;
}

/** Stage finishing durable state, then every timelineImage image body under its rebound source identity. */
export async function stageFramescaperScapeImportAssetsTimelineImage(
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const supplied = importValidation(request.validation);
	const archiveProject = request.archiveProject as unknown as FramescaperProjectTimelineImage;
	const images = validateFramescaperScapeImageImportAssetsTimelineImage(archiveProject, request.manifest);
	assertImageValidation(supplied.images, images);
	await stageFramescaperScapeImportAssetsFinishing({ ...request, validation: supplied.foundation });
	for (const reference of images.references) {
		throwIfScapeAborted(request.signal);
		const descriptor = images.descriptorByArchiveId.get(reference.archiveId)!;
		const entry = request.entryByName.get(descriptor.entry);
		if (!entry) throw new Error(`The timelineImage Scape archive is missing ${descriptor.entry}.`);
		const source = reboundImageSource(reference, request.project, request.sourceIdMap);
		const existing = await request.store.getMediaAssetMetadata(source.storageKey);
		if (existing !== null && existing !== undefined) {
			const extracted = await extractScapeVideo(
				entry, discardWriter(), request.signal, request.expandedByteBudget,
			);
			verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, reference.archiveId);
			await verifyStoredImageBody(existing, source, request);
			continue;
		}
		await stageImageBody(source, entry, descriptor, request);
	}
}

async function stageImageBody(
	source: FramescaperImageSourceV1,
	entry: Parameters<typeof extractScapeVideo>[0],
	descriptor: Parameters<typeof verifyScapeExtractedAsset>[0],
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const writer = await request.store.beginMediaAssetWrite(source.storageKey, {
		name: source.name,
		kind: 'timeline-image',
		encoding: FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_TIMELINE_IMAGE,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	}, {
		expectedBytes: source.assetByteLength,
		expectedSha256: source.contentSha256,
		...(request.signal ? { signal: request.signal } : {}),
	});
	assertOwnedWriter(writer);
	let publication: OwnedMediaAssetPublication | null = null;
	let tracked = false;
	try {
		const extracted = await extractScapeVideo(
			entry, writer, request.signal, request.expandedByteBudget,
		);
		verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, source.storageKey);
		publication = await writer.commitOwned(signalOptions(request.signal));
		throwIfScapeAborted(request.signal);
		assertStoredImageMetadata(publication.metadata, source);
		await verifyStoredImageBody(publication.metadata, source, request);
		request.transaction.trackProvisionalMedia(publication);
		tracked = true;
	} catch (error) {
		if (tracked) throw error;
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw aggregateScapeErrors(
				error, [cleanupError], 'The timelineImage Scape image write and cleanup both failed.',
			);
		}
		throw error;
	}
}

async function verifyStoredImageBody(
	metadata: unknown,
	source: FramescaperImageSourceV1,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	assertStoredImageMetadata(metadata, source);
	if (typeof request.store.loadMediaAsset !== 'function') {
		throw new TypeError('The timelineImage Scape import requires immutable image-body reads.');
	}
	const body = canonicalMediaContentBlob(await request.store.loadMediaAsset(
		source.storageKey, signalOptions(request.signal),
	));
	await validateFramescaperImageAssetBodyTimelineImage(source, body, request.signal);
}

function reboundImageSource(
	reference: FramescaperScapeImageAssetReferenceTimelineImage,
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): FramescaperImageSourceV1 {
	const targetId = sourceIdMap.get(reference.sourceId) ?? reference.sourceId;
	const sourceValue = records(project.sources, 'rebound timelineImage sources').find(({ id }) => id === targetId);
	if (!sourceValue || sourceValue.kind !== 'image') {
		throw new Error(`The timelineImage image body ${reference.sourceId} lost its rebound source.`);
	}
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	const originalIdentity = normalizeFramescaperImageSourceV1({
		...source,
		id: reference.sourceId,
		storageKey: reference.source.storageKey,
	});
	if (JSON.stringify(originalIdentity) !== JSON.stringify(reference.source)) {
		throw new Error(`The rebound timelineImage image ${targetId} changed immutable content authority.`);
	}
	return source;
}

function assertStoredImageMetadata(value: unknown, source: FramescaperImageSourceV1): void {
	const metadata = record(value, `stored timelineImage image ${source.storageKey} metadata`);
	if (metadata.sourceId !== source.storageKey || metadata.size !== source.assetByteLength
		|| metadata.sha256 !== source.contentSha256
		|| (metadata.mimeType !== undefined && metadata.mimeType !== ''
			&& metadata.mimeType !== FRAMESCAPER_IMAGE_ASSET_MIME_TYPE)
		|| (metadata.kind !== undefined && metadata.kind !== '' && metadata.kind !== 'timeline-image')
		|| (metadata.encoding !== undefined && metadata.encoding !== ''
			&& metadata.encoding !== FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_TIMELINE_IMAGE)) {
		throw new Error(`Stored timelineImage image ${source.storageKey} conflicts with immutable authority.`);
	}
}

function importValidation(value: unknown): FramescaperScapeImportValidationTimelineImage {
	const candidate = record(value, 'timelineImage Scape import validation');
	if (Reflect.ownKeys(candidate).length !== 2
		|| !Object.hasOwn(candidate, 'foundation') || !Object.hasOwn(candidate, 'images')) {
		throw new TypeError('The exact timelineImage Scape import validation is required.');
	}
	const foundation = record(candidate.foundation, 'timelineImage Scape foundation validation');
	const images = record(candidate.images, 'timelineImage Scape image validation');
	if (!Array.isArray(foundation.references) || !(foundation.descriptorByArchiveId instanceof Map)
		|| !Array.isArray(images.references) || !(images.descriptorByArchiveId instanceof Map)) {
		throw new TypeError('The timelineImage Scape import validation is incomplete.');
	}
	return candidate as unknown as FramescaperScapeImportValidationTimelineImage;
}

function assertImageValidation(
	supplied: Readonly<FramescaperScapeImageImportValidationTimelineImage>,
	expected: Readonly<FramescaperScapeImageImportValidationTimelineImage>,
): void {
	if (JSON.stringify(supplied.references) !== JSON.stringify(expected.references)
		|| supplied.descriptorByArchiveId.size !== expected.descriptorByArchiveId.size) {
		throw new Error('The timelineImage Scape image validation drifted before staging.');
	}
	for (const [archiveId, descriptor] of expected.descriptorByArchiveId) {
		if (JSON.stringify(supplied.descriptorByArchiveId.get(archiveId)) !== JSON.stringify(descriptor)) {
			throw new Error(`The timelineImage Scape descriptor ${archiveId} drifted before staging.`);
		}
	}
	const archiveReferences = collectFramescaperScapeImageAssetReferencesTimelineImage(
		{ sources: expected.references.map(({ source }) => source) } as unknown as FramescaperProjectTimelineImage,
	);
	if (JSON.stringify(archiveReferences) !== JSON.stringify(expected.references)) {
		throw new Error('The timelineImage Scape image validation no longer closes over its sources.');
	}
}

function discardWriter(): ScapeVideoWriter {
	let bytesWritten = 0;
	return {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		get bytesWritten() { return bytesWritten; },
		async write(value) { bytesWritten += value.byteLength; },
		async commit() { return {}; },
		async abort() {},
	};
}

function assertOwnedWriter(value: unknown): asserts value is OwnedMediaAssetWriter {
	const writer = value as Partial<OwnedMediaAssetWriter> | null;
	if (writer?.maximumChunkBytes !== SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES
		|| typeof writer.write !== 'function' || typeof writer.commitOwned !== 'function'
		|| typeof writer.abort !== 'function') {
		throw new TypeError('The timelineImage Scape import requires an exact bounded owned media writer.');
	}
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Record<string, unknown>;
}

function signalOptions(signal?: AbortSignal): Readonly<{ signal?: AbortSignal }> {
	return signal ? { signal } : {};
}

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
} from '../common/editor/timeline-image-model-v30.ts';
import { stageFramescaperScapeImportAssetsV27 } from './editor-scape-asset-import-v27.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V30,
	collectFramescaperScapeImageAssetReferencesV30,
	validateFramescaperImageAssetBodyV30,
	validateFramescaperScapeImageImportAssetsV30,
	type FramescaperScapeImageAssetReferenceV30,
	type FramescaperScapeImageImportValidationV30,
} from './editor-scape-asset-plan-v30.ts';
import type { FramescaperScapeImportValidationV27 } from './editor-scape-asset-plan-v27.ts';
import type { FramescaperProjectV30 } from './editor-project-v30.ts';

export interface FramescaperScapeImportValidationV30 {
	readonly foundation: Readonly<FramescaperScapeImportValidationV27>;
	readonly images: Readonly<FramescaperScapeImageImportValidationV30>;
}

/** Stage V27 durable state, then every V30 image body under its rebound source identity. */
export async function stageFramescaperScapeImportAssetsV30(
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const supplied = importValidation(request.validation);
	const archiveProject = request.archiveProject as unknown as FramescaperProjectV30;
	const images = validateFramescaperScapeImageImportAssetsV30(archiveProject, request.manifest);
	assertImageValidation(supplied.images, images);
	await stageFramescaperScapeImportAssetsV27({ ...request, validation: supplied.foundation });
	for (const reference of images.references) {
		throwIfScapeAborted(request.signal);
		const descriptor = images.descriptorByArchiveId.get(reference.archiveId)!;
		const entry = request.entryByName.get(descriptor.entry);
		if (!entry) throw new Error(`The V30 Scape archive is missing ${descriptor.entry}.`);
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
		encoding: FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V30,
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
				error, [cleanupError], 'The V30 Scape image write and cleanup both failed.',
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
		throw new TypeError('The V30 Scape import requires immutable image-body reads.');
	}
	const body = canonicalMediaContentBlob(await request.store.loadMediaAsset(
		source.storageKey, signalOptions(request.signal),
	));
	await validateFramescaperImageAssetBodyV30(source, body, request.signal);
}

function reboundImageSource(
	reference: FramescaperScapeImageAssetReferenceV30,
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): FramescaperImageSourceV1 {
	const targetId = sourceIdMap.get(reference.sourceId) ?? reference.sourceId;
	const sourceValue = records(project.sources, 'rebound V30 sources').find(({ id }) => id === targetId);
	if (!sourceValue || sourceValue.kind !== 'image') {
		throw new Error(`The V30 image body ${reference.sourceId} lost its rebound source.`);
	}
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	const originalIdentity = normalizeFramescaperImageSourceV1({
		...source,
		id: reference.sourceId,
		storageKey: reference.source.storageKey,
	});
	if (JSON.stringify(originalIdentity) !== JSON.stringify(reference.source)) {
		throw new Error(`The rebound V30 image ${targetId} changed immutable content authority.`);
	}
	return source;
}

function assertStoredImageMetadata(value: unknown, source: FramescaperImageSourceV1): void {
	const metadata = record(value, `stored V30 image ${source.storageKey} metadata`);
	if (metadata.sourceId !== source.storageKey || metadata.size !== source.assetByteLength
		|| metadata.sha256 !== source.contentSha256
		|| (metadata.mimeType !== undefined && metadata.mimeType !== ''
			&& metadata.mimeType !== FRAMESCAPER_IMAGE_ASSET_MIME_TYPE)
		|| (metadata.kind !== undefined && metadata.kind !== '' && metadata.kind !== 'timeline-image')
		|| (metadata.encoding !== undefined && metadata.encoding !== ''
			&& metadata.encoding !== FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_V30)) {
		throw new Error(`Stored V30 image ${source.storageKey} conflicts with immutable authority.`);
	}
}

function importValidation(value: unknown): FramescaperScapeImportValidationV30 {
	const candidate = record(value, 'V30 Scape import validation');
	if (Reflect.ownKeys(candidate).length !== 2
		|| !Object.hasOwn(candidate, 'foundation') || !Object.hasOwn(candidate, 'images')) {
		throw new TypeError('The exact V30 Scape import validation is required.');
	}
	const foundation = record(candidate.foundation, 'V30 Scape foundation validation');
	const images = record(candidate.images, 'V30 Scape image validation');
	if (!Array.isArray(foundation.references) || !(foundation.descriptorByArchiveId instanceof Map)
		|| !Array.isArray(images.references) || !(images.descriptorByArchiveId instanceof Map)) {
		throw new TypeError('The V30 Scape import validation is incomplete.');
	}
	return candidate as unknown as FramescaperScapeImportValidationV30;
}

function assertImageValidation(
	supplied: Readonly<FramescaperScapeImageImportValidationV30>,
	expected: Readonly<FramescaperScapeImageImportValidationV30>,
): void {
	if (JSON.stringify(supplied.references) !== JSON.stringify(expected.references)
		|| supplied.descriptorByArchiveId.size !== expected.descriptorByArchiveId.size) {
		throw new Error('The V30 Scape image validation drifted before staging.');
	}
	for (const [archiveId, descriptor] of expected.descriptorByArchiveId) {
		if (JSON.stringify(supplied.descriptorByArchiveId.get(archiveId)) !== JSON.stringify(descriptor)) {
			throw new Error(`The V30 Scape descriptor ${archiveId} drifted before staging.`);
		}
	}
	const archiveReferences = collectFramescaperScapeImageAssetReferencesV30(
		{ sources: expected.references.map(({ source }) => source) } as unknown as FramescaperProjectV30,
	);
	if (JSON.stringify(archiveReferences) !== JSON.stringify(expected.references)) {
		throw new Error('The V30 Scape image validation no longer closes over its sources.');
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
		throw new TypeError('The V30 Scape import requires an exact bounded owned media writer.');
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

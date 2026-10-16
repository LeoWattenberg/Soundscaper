/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { encodeImageHdrOriginalV1, readImageHdrOriginalV1 } from '../../src/common/editor/imaging/image-hdr-original-v1.ts';
import { defaultImageDevelopStateV1 } from '../../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { createImageDevelopHandoffProvenanceHdrCurrentV1 } from '../../src/common/editor/image-develop-handoff-provenance-hdr-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1 } from '../../src/common/editor/timeline-image-model-hdr-current-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../src/common/editor/timeline-image-model.ts';
import { createPhotoFramescaperHandoffProjectCurrentV1 } from '../../src/lightscaper/controller/photo-framescaper-handoff-project-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';

export const HDR_FRAME_TIME = '2026-10-16T00:00:00.000Z';
export const HDR_FRAME_SAMPLES = [3, .5, -.25, 1, 1e-30, -0, 1 / 65535, 1] as const;
export const hdrFrameDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function hdrFrameDisplay(value: number): number {
	value = Math.max(0, Math.min(1, value));
	return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
}

/** Real HDR codec and FramePack1; independent signed/tiny literals are the
 * oracle. The deliberately false byte cache has no native pixel authority. */
export async function hdrFrameFixtureCurrentV1(developValue: ImageDevelopStateThroughV4 = defaultImageDevelopStateV1()) {
	const develop = normalizeImageDevelopStateThroughV4(developValue);
	const descriptor = { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } as const;
	const provenance = { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .15 },
		inputs: [1, .25].map((exposureMultiplier, index) => ({ product: 'lightscaper', ownerId: 'bracket-catalog', sourceId: `bracket-${index}`, revision: 1,
			original: { fileName: `${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: String(index + 1).repeat(64), byteLength: 1024, width: 2, height: 1 },
			profile: 'linear-srgb16', exposureMultiplier, offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 2 })),
		output: { x: 0, y: 0, width: 2, height: 1 } };
	const original = await encodeImageHdrOriginalV1({ descriptor, pixels: Float32Array.from(HDR_FRAME_SAMPLES) }, provenance);
	const parsed = readImageHdrOriginalV1(original);
	const hdr = { schemaVersion: 1, format: 'lightscaper-hdr', bodyVersion: 1, descriptor, pixelEncoding: 'rgb32f-le',
		pixelsSha256: parsed.pixelsSha256, metadataSha256: parsed.metadataSha256 };
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, kind: 'hdr-original', hdr }, width: 2, height: 1,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255) }] });
	const seed = queryPhotoV1(), photo = normalizePhotoDocumentCurrentV1({ ...seed, schemaVersion: 3, folderId: null, collectionIds: [], keywordIds: [],
		original: { ...seed.original, name: 'Merged.lshdr', mimeType: 'image/x-lightscaper-hdr', width: 2, height: 1, hasAlpha: false,
			contentSha256: hdrFrameDigest(original), byteLength: original.length },
		versions: seed.versions.map(version => ({ ...version, develop })) });
	const binding = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const factsJson = serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo, binding));
	const active = photo.versions.find(version => version.id === photo.activeVersionId)!;
	const source = normalizeFramescaperHdrImageSourceCurrentV1({ schemaVersion: 5, kind: 'image', id: 'hdr-source', name: 'Merged HDR', storageKey: 'hdr-source',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
		original: { fileName: photo.original.name, mimeType: photo.original.mimeType, recognizedFormat: 'lightscaper-hdr', byteLength: original.length, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 1, hasAlpha: false, frameCount: 1, durationTicks: '5000000', timingMode: 'fallback' },
		conversionReceiptSha256: pack.conversionReceiptSha256, develop, developed: { width: 2, height: 1 },
		provenance: createImageDevelopHandoffProvenanceHdrCurrentV1({ develop, original: { exactName: photo.original.name, sha256: pack.originalSha256, byteLength: original.length },
			origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision,
				versionId: active.id, versionKind: active.kind, versionName: active.name, versionCreatedAt: active.createdAt } }), hdr });
	const body = new Blob([new Uint8Array(pack.bytes)], { type: source.mimeType });
	return { source, pack, body, original, photo, factsJson, binding, descriptor, hdr,
		project: () => createPhotoFramescaperHandoffProjectCurrentV1(source, { projectId: 'hdr-project', sequenceId: 'hdr-sequence', trackId: 'hdr-track', clipId: 'hdr-clip', now: HDR_FRAME_TIME }),
		capture: { factsJson, original: { exactName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength,
			mimeType: photo.original.mimeType!, width: 2, height: 1, hasAlpha: false }, originalBlob: new Blob([original], { type: photo.original.mimeType! }), signal: new AbortController().signal } };
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoImportMappingNoticeV1 } from './metadata-adapter-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { FramescaperImageFramePackPublicationV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { readImageMetadataV1 } from '../../common/editor/imaging/image-metadata-reader-v1.ts';
import { decodeFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-browser-native-port.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../common/editor/timeline-image-model.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { adaptPhotoImportMetadataV1 } from './metadata-adapter-v1.ts';
import { admitPhotoSourceV1 } from './photo-source-admission-v1.ts';
import { createPhotoNativeImagePortV1 } from './photo-native-image-port-v1.ts';
import { admitPhotoImportPreparationPlanV1, type PhotoImportPreparationPlanV1, type SelectedPhotoOriginalV1 } from './internal/photo-import-preparation-plan-v1.ts';

export interface PhotoImportPreparedV1 {
	readonly outcome: 'prepared';
	readonly index: number;
	readonly fileName: string;
	readonly photo: PhotoDocumentV1;
	readonly original: Blob;
	/** Transient shared decode artifact; includes original bytes, not a thumbnail tier. */
	readonly decodeArtifact: Readonly<Omit<FramescaperImageFramePackPublicationV1, 'bytes'> & { body: Blob }>;
	readonly keywordNames: readonly string[];
	readonly notices: readonly Readonly<PhotoImportMappingNoticeV1>[];
}

export type PhotoImportOutcomeV1 = Readonly<PhotoImportPreparedV1> | Readonly<{
	outcome: 'failed'; index: number; fileName: string; error: unknown;
}>;

export function preparePhotoImportGestureV1(
	value: unknown,
	dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {},
): AsyncGenerator<PhotoImportOutcomeV1> {
	const plan = admitPhotoImportPreparationPlanV1(value);
	const ports = readClosedDomainRecord(dependencies, 'photo preparation ports', ['openImage'], []);
	const openImage = Object.hasOwn(ports, 'openImage') ? readClosedDomainField(ports, 'openImage', 'photo preparation ports') : openFramescaperBrowserNativeImageV1;
	if (typeof openImage !== 'function') throw new TypeError('Photo preparation requires a native image port.');
	return prepare(plan, openImage as OpenFramescaperBrowserNativeImageV1);
}

async function* prepare(plan: PhotoImportPreparationPlanV1, openImage: OpenFramescaperBrowserNativeImageV1): AsyncGenerator<PhotoImportOutcomeV1> {
	for (const [index, selected] of plan.originals.entries()) {
		plan.signal?.throwIfAborted();
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(new DOMException('Photo preparation exceeded its decode deadline.', 'TimeoutError')), IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
		const signal = plan.signal ? AbortSignal.any([plan.signal, deadline.signal]) : deadline.signal;
		let outcome: PhotoImportOutcomeV1;
		try { outcome = await preparePhotoRasterOriginalV1(selected, index, plan.templates[index]!, openImage, signal); }
		catch (error) { plan.signal?.throwIfAborted(); outcome = Object.freeze({ outcome: 'failed', index, fileName: selected.fileName, error }); }
		finally { clearTimeout(timer); }
		plan.signal?.throwIfAborted();
		yield outcome;
	}
}

/** Shared raster preparation; Current may supply its already captured File read. */
export async function preparePhotoRasterOriginalV1(selected: SelectedPhotoOriginalV1, index: number, template: PhotoDocumentV1,
	openImage: OpenFramescaperBrowserNativeImageV1, signal: AbortSignal, capturedBytes?: Uint8Array<ArrayBuffer>): Promise<Readonly<PhotoImportPreparedV1>> {
	signal.throwIfAborted();
	const bytes = capturedBytes ?? new Uint8Array(await Blob.prototype.arrayBuffer.call(selected.file));
	signal.throwIfAborted();
	if (bytes.length !== selected.byteLength) throw new RangeError('Selected original bytes disagree with its File length.');
	const admission = admitPhotoSourceV1(bytes), originalSha256 = bytesToHex(sha256(bytes));
	const facts = adaptPhotoImportMetadataV1({ fileName: selected.fileName, modifiedTime: selected.modifiedTime,
		byteLength: selected.byteLength, extractedMetadata: readImageMetadataV1(bytes) });
	// Snapshot the one read before exposing its writable byte array to the decoder.
	const original = new Blob([bytes], { type: `image/${admission.format}` });
	// Shared transient pack labels are NFC; the selected original identity stays exact.
	const canonicalLabel = selected.fileName.normalize('NFC');
	const decoded = await decodeFramescaperBrowserNativeImageV1({ bytes, fileName: canonicalLabel.length <= 512 ? canonicalLabel : selected.originalId,
		mimeTypeHint: selected.mimeTypeHint, signal,
		open: createPhotoNativeImagePortV1(admission, facts.metadata.orientation, openImage, signal),
	});
	signal.throwIfAborted();
	const artifact = decoded.publication;
	if (artifact.originalSha256 !== originalSha256 || artifact.originalByteLength !== selected.byteLength) throw new RangeError('Shared decode artifact replaced the selected original binding.');
	const photo = validateLightscaperDocumentV1({ ...template,
		original: { ...template.original, contentSha256: originalSha256, mimeType: decoded.canonicalMimeType, width: artifact.width, height: artifact.height, hasAlpha: artifact.hasAlpha },
		metadata: facts.metadata, extractedMetadata: facts.extractedMetadata });
	if (photo.kind !== 'photo') throw new TypeError('Prepared document requires its photo owner.');
	const { bytes: artifactBytes, ...description } = artifact;
	if (original.size !== selected.byteLength) throw new RangeError('Original Blob snapshot has the wrong length.');
	return Object.freeze({ outcome: 'prepared', index, fileName: selected.fileName, photo, original,
		decodeArtifact: Object.freeze({ ...description, body: new Blob([artifactBytes.slice()], { type: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE }) }),
		keywordNames: facts.keywordNames, notices: facts.notices });
}

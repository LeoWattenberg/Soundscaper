/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoImportMappingNoticeV1 } from './metadata-adapter-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { FramescaperImageFramePackPublicationV1 } from '../../common/editor/timeline-image-frame-pack-v1.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { admitImageImportGesture, IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { readImageMetadataV1 } from '../../common/editor/imaging/image-metadata-reader-v1.ts';
import { decodeFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-browser-native-port.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../common/editor/timeline-image-model.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { validatePhotoCatalogReferencesV1 } from '../catalog/photo-document.ts';
import { defaultPhotoDevelopV1 } from '../catalog/develop-state.ts';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../catalog/photo-metadata.ts';
import { id, name, unique, utcTimestamp } from '../catalog/value-validation.ts';
import { adaptPhotoImportMetadataV1 } from './metadata-adapter-v1.ts';
import { admitPhotoSourceV1 } from './photo-source-admission-v1.ts';
import { createPhotoNativeImagePortV1 } from './photo-native-image-port-v1.ts';

interface Ownership { readonly photoId: string; readonly originalId: string; readonly originalStorageKey: string; readonly masterVersionId: string }
interface SelectedOriginal extends Ownership { readonly file: File; readonly fileName: string; readonly byteLength: number; readonly mimeTypeHint: string | null; readonly modifiedTime: string }
interface Plan { readonly originals: readonly SelectedOriginal[]; readonly templates: readonly PhotoDocumentV1[]; readonly signal?: AbortSignal }
const ZERO_DIGEST = '0'.repeat(64);
const getName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const getModified = Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')!.get!;
const getSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const getType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;

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
	const plan = admitGesture(value);
	const ports = readClosedDomainRecord(dependencies, 'photo preparation ports', ['openImage'], []);
	const openImage = Object.hasOwn(ports, 'openImage') ? readClosedDomainField(ports, 'openImage', 'photo preparation ports') : openFramescaperBrowserNativeImageV1;
	if (typeof openImage !== 'function') throw new TypeError('Photo preparation requires a native image port.');
	return prepare(plan, openImage as OpenFramescaperBrowserNativeImageV1);
}

function admitGesture(value: unknown): Plan {
	const input = readClosedDomainRecord(value, 'photo import gesture', ['files', 'ownership', 'catalog', 'createdAt', 'folderId', 'signal'], ['files', 'ownership', 'catalog', 'createdAt']);
	const field = (key: string) => readClosedDomainField(input, key, 'photo import gesture');
	const candidates = readClosedDomainArray(field('files'), 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture);
	const owners = readClosedDomainArray(field('ownership'), 'photo ownership', candidates.length, candidates.length).map(ownership);
	for (const key of ['photoId', 'originalId', 'originalStorageKey', 'masterVersionId'] as const) unique(owners.map(owner => owner[key]), `import ${key}`);
	const catalog = validateLightscaperDocumentV1(field('catalog'));
	if (catalog.kind !== 'photo-catalog') throw new TypeError('Photo import requires a catalog root.');
	const createdAt = utcTimestamp(field('createdAt'), 'photo import creation time');
	const folderId = Object.hasOwn(input, 'folderId') && field('folderId') !== null ? id(field('folderId'), 'import folder') : null;
	const signal = Object.hasOwn(input, 'signal') ? field('signal') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo import requires a cancellation signal.');
	signal?.throwIfAborted();
	const originals = candidates.map((candidate, index): SelectedOriginal => {
		// Intrinsic accessors brand-check genuine File/Blob slots, ignoring subclass overrides.
		const fileName = name(getName.call(candidate), 'selected photo filename');
		const byteLength: unknown = getSize.call(candidate), modified: unknown = getModified.call(candidate), mime: unknown = getType.call(candidate);
		if (typeof byteLength !== 'number' || typeof modified !== 'number' || typeof mime !== 'string') throw new TypeError('Photo selection requires genuine File metadata.');
		const modifiedTime = utcTimestamp(new Date(modified).toISOString(), 'selected photo modified time');
		return Object.freeze({ ...owners[index]!, file: candidate as File, fileName, byteLength, mimeTypeHint: mime || null, modifiedTime });
	});
	admitImageImportGesture({ fileByteLengths: originals.map(original => original.byteLength) });
	const templates = originals.map(original => {
		const photo = validateLightscaperDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
			id: original.photoId, catalogId: catalog.id, revision: 0,
			original: { schemaVersion: 1, kind: 'still', id: original.originalId, storageKey: original.originalStorageKey, name: original.fileName,
				mimeType: 'image/png', contentSha256: ZERO_DIGEST, byteLength: original.byteLength, width: 1, height: 1, hasAlpha: false, retention: 'managed' },
			metadata: normalizePhotoMetadataV1({ ...emptyPhotoMetadataV1(original.fileName), modifiedTime: original.modifiedTime }), extractedMetadata: null,
			folderId, collectionIds: [], keywordIds: [], rating: 0, flag: 'unflagged', colorLabel: 'none',
			versions: [{ id: original.masterVersionId, kind: 'master', name: 'Original', createdAt, develop: defaultPhotoDevelopV1() }], activeVersionId: original.masterVersionId });
		if (photo.kind !== 'photo') throw new TypeError('Photo template requires its photo domain owner.');
		validatePhotoCatalogReferencesV1(photo, catalog); return photo;
	});
	return Object.freeze({ originals: Object.freeze(originals), templates: Object.freeze(templates), ...(signal === undefined ? {} : { signal }) });
}

function ownership(value: unknown): Ownership {
	const input = readClosedDomainRecord(value, 'photo import ownership', ['photoId', 'originalId', 'originalStorageKey', 'masterVersionId']);
	const field = (key: string) => id(readClosedDomainField(input, key, 'photo import ownership'), `import ${key}`);
	return Object.freeze({ photoId: field('photoId'), originalId: field('originalId'), originalStorageKey: field('originalStorageKey'), masterVersionId: field('masterVersionId') });
}

async function* prepare(plan: Plan, openImage: OpenFramescaperBrowserNativeImageV1): AsyncGenerator<PhotoImportOutcomeV1> {
	for (const [index, selected] of plan.originals.entries()) {
		plan.signal?.throwIfAborted();
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(new DOMException('Photo preparation exceeded its decode deadline.', 'TimeoutError')), IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
		const signal = plan.signal ? AbortSignal.any([plan.signal, deadline.signal]) : deadline.signal;
		let outcome: PhotoImportOutcomeV1;
		try { outcome = await prepareOriginal(selected, index, plan.templates[index]!, openImage, signal); }
		catch (error) { plan.signal?.throwIfAborted(); outcome = Object.freeze({ outcome: 'failed', index, fileName: selected.fileName, error }); }
		finally { clearTimeout(timer); }
		plan.signal?.throwIfAborted();
		yield outcome;
	}
}

async function prepareOriginal(selected: SelectedOriginal, index: number, template: PhotoDocumentV1,
	openImage: OpenFramescaperBrowserNativeImageV1, signal: AbortSignal): Promise<Readonly<PhotoImportPreparedV1>> {
	signal.throwIfAborted();
	const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(selected.file));
	signal.throwIfAborted();
	if (bytes.length !== selected.byteLength) throw new RangeError('Selected original bytes disagree with its File length.');
	const admission = admitPhotoSourceV1(bytes), originalSha256 = bytesToHex(sha256(bytes));
	const facts = adaptPhotoImportMetadataV1({ fileName: selected.fileName, modifiedTime: selected.modifiedTime,
		byteLength: selected.byteLength, extractedMetadata: readImageMetadataV1(bytes) });
	// Snapshot the one read before exposing its writable byte array to the decoder.
	const original = new Blob([bytes], { type: `image/${admission.format}` });
	const decoded = await decodeFramescaperBrowserNativeImageV1({ bytes, fileName: selected.fileName,
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

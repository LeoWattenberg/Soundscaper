/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../../catalog/types.ts';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../../../common/editor/closed-domain-value.ts';
import { admitImageImportGesture, IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { validateLightscaperDocumentV1 } from '../../catalog/documents.ts';
import { validatePhotoCatalogReferencesV1 } from '../../catalog/photo-document.ts';
import { defaultPhotoDevelopV1 } from '../../catalog/develop-state.ts';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../../catalog/photo-metadata.ts';
import { id, name, unique, utcTimestamp } from '../../catalog/value-validation.ts';

interface Ownership { readonly photoId: string; readonly originalId: string; readonly originalStorageKey: string; readonly masterVersionId: string }
export interface SelectedPhotoOriginalV1 extends Ownership {
	readonly file: File; readonly fileName: string; readonly byteLength: number; readonly mimeTypeHint: string | null; readonly modifiedTime: string;
}
export interface PhotoImportPreparationPlanV1 {
	readonly originals: readonly SelectedPhotoOriginalV1[]; readonly templates: readonly PhotoDocumentV1[]; readonly signal?: AbortSignal;
}
const ZERO_DIGEST = '0'.repeat(64);
const getName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const getModified = Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')!.get!;
const getSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const getType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!.get!;

/** Shared inert File/ownership admission. It selects neither decoder nor route. */
export function admitPhotoImportPreparationPlanV1(value: unknown): PhotoImportPreparationPlanV1 {
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
	const originals = candidates.map((candidate, index): SelectedPhotoOriginalV1 => {
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

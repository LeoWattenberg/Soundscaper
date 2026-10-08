/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS } from '../catalog/repository-types.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { integer } from '../catalog/value-validation.ts';

/** Tiny immutable media isolates catalog scale, rather than camera decode or representative hardware. */
export const PHOTO_LARGE_LIBRARY_PNG_BASE64_V1 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==';
export const PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 = Object.freeze({
	id: 'lightscaper-large-library-20000-v1', generatorRevision: 1, photoCount: 20_000,
	publicationBatchSize: 16, presentationPageSize: 64, width: 2, height: 2,
	maximumDocumentBytes: 16_384,
	sourceByteLength: 163, sourceSha256: '53da2d7acaff4a63fe169b1c8c76ab63f4cfa8d5182868d2ba9f356a97586e6c',
	sparseSearchText: 'Distant library search token',
});
const SPEC = PHOTO_LARGE_LIBRARY_SPECIFICATION_V1;
const COLORS = ['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const;

export function largeLibraryPhotoIdV1(index: unknown): string {
	return `large-photo-${String(integer(index, 0, SPEC.photoCount - 1, 'fixture photo index')).padStart(5, '0')}`;
}

/** At most one publication batch; callers own persistence, custody and timing observations. */
export function createLargeLibraryPhotoBatchV1(template: unknown, offset: unknown): readonly PhotoDocumentV1[] {
	const start = integer(offset, 0, SPEC.photoCount - 1, 'fixture batch offset');
	const source = normalizePhotoDocumentV1(template), original = source.original;
	if (source.revision !== 0 || source.versions.length !== 1 || source.versions[0]!.kind !== 'master'
		|| original.width !== SPEC.width || original.height !== SPEC.height || original.byteLength !== SPEC.sourceByteLength
		|| original.contentSha256 !== SPEC.sourceSha256 || original.mimeType !== 'image/png' || original.retention !== 'managed') {
		throw new RangeError('Large-library fixture requires its exact pinned initial source.');
	}
	if (new TextEncoder().encode(JSON.stringify(source)).byteLength > SPEC.maximumDocumentBytes) throw new RangeError('Fixture template exceeds its document byte bound.');
	if (SPEC.publicationBatchSize !== PHOTO_CATALOG_REPOSITORY_LIMITS.maximumImportPhotos
		|| SPEC.presentationPageSize !== PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize) throw new RangeError('Fixture page bounds differ from the production catalog.');
	const count = Math.min(SPEC.publicationBatchSize, SPEC.photoCount - start);
	return Object.freeze(Array.from({ length: count }, (_, item) => {
		const index = start + item, masterId = `large-master-${String(index).padStart(5, '0')}`;
		const photo = normalizePhotoDocumentV1({ ...source, id: largeLibraryPhotoIdV1(index), activeVersionId: masterId,
			versions: [{ ...source.versions[0]!, id: masterId }],
			metadata: { ...source.metadata, fileName: `Photo-${String(SPEC.photoCount - index).padStart(5, '0')}.png`,
				title: index === SPEC.photoCount - 1 ? SPEC.sparseSearchText : `Library fixture ${index % 100}`,
				captureTime: index % 3 === 0 ? null : { local: `2026-09-${String(index % 28 + 1).padStart(2, '0')}T12:00:00.000`, offsetMinutes: null } },
			folderId: index % 37 === 0 ? 'folder-one' : null,
			keywordIds: index % 2 === 0 ? ['landscape'] : [], collectionIds: index % 3 === 0 ? ['manual'] : [],
			rating: index % 6, flag: index % 10 === 0 ? 'reject' : index % 4 === 0 ? 'pick' : 'unflagged', colorLabel: COLORS[index % COLORS.length]!,
		});
		if (new TextEncoder().encode(JSON.stringify(photo)).byteLength > SPEC.maximumDocumentBytes) throw new RangeError('Fixture photo exceeds its document byte bound.');
		return photo;
	}));
}

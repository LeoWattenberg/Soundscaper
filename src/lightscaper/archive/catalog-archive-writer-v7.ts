/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_PACK_ENCODING_V4 } from '../../common/editor/scape-photo-catalog-pack-v4.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { encodePhotoCatalogPackV4, type PhotoCatalogPackInputV4 } from './catalog-pack-v4.ts';
import { PhotoCatalogPackSequenceV4 } from './catalog-pack-sequence-v4.ts';
import { maximumPhotoCatalogStreamingOutputBytesV6 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchiveKernel, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchivePrepare,
	type PhotoCatalogArchiveWrittenResult, type PhotoCatalogArchiveWriterProfile } from './catalog-archive-writer-kernel.ts';
export type { PhotoCatalogArchiveExportOptions, PhotoCatalogArchivePackWriter, PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-kernel.ts';

const profile = Object.freeze<PhotoCatalogArchiveWriterProfile<'current3'>>({ encoding: PHOTO_CATALOG_PACK_ENCODING_V4, schemaVersion: 7,
	maximumStreamingOutputBytes: maximumPhotoCatalogStreamingOutputBytesV6(), encode: encodePhotoCatalogPackV4,
	sequence: (photos, identity, signal) => new PhotoCatalogPackSequenceV4(photos, identity, signal) });
export function writePhotoCatalogArchiveV7<Document>(root: PhotoCatalogRootV1,
	photos: Iterable<PhotoCatalogPackInputV4> | AsyncIterable<PhotoCatalogPackInputV4>, identity: PhotoCatalogArchiveIdentityGuard,
	prepare: PhotoCatalogArchivePrepare<Document, 7>, options: PhotoCatalogArchiveExportOptions = {},
	maximumStreamingOutputBytes = maximumPhotoCatalogStreamingOutputBytesV6()): Promise<PhotoCatalogArchiveWrittenResult<Document>> {
	return writePhotoCatalogArchiveKernel(root, photos, identity, prepare, options, profile, maximumStreamingOutputBytes);
}

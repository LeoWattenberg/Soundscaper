/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_PACK_ENCODING_V2 } from '../../common/editor/scape-photo-catalog-pack-v2.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { encodePhotoCatalogPackV2, type PhotoCatalogPackInputV2 } from './catalog-pack-v2.ts';
import { PhotoCatalogPackSequenceV2 } from './catalog-pack-sequence-v2.ts';
import { maximumPhotoCatalogStreamingOutputBytesV5 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchiveKernel, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchivePrepare,
	type PhotoCatalogArchiveWrittenResult, type PhotoCatalogArchiveWriterProfile } from './catalog-archive-writer-kernel.ts';
export type { PhotoCatalogArchiveExportOptions, PhotoCatalogArchivePackWriter, PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-kernel.ts';

const profile = Object.freeze<PhotoCatalogArchiveWriterProfile>({ encoding: PHOTO_CATALOG_PACK_ENCODING_V2, schemaVersion: 5,
	maximumStreamingOutputBytes: maximumPhotoCatalogStreamingOutputBytesV5(), encode: encodePhotoCatalogPackV2,
	sequence: (photos, identity, signal) => new PhotoCatalogPackSequenceV2(photos, identity, signal) });
export function writePhotoCatalogArchiveV5<Document>(root: PhotoCatalogRootV1,
	photos: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>, identity: PhotoCatalogArchiveIdentityGuard,
	prepare: PhotoCatalogArchivePrepare<Document, 5>, options: PhotoCatalogArchiveExportOptions = {},
	maximumStreamingOutputBytes = maximumPhotoCatalogStreamingOutputBytesV5()): Promise<PhotoCatalogArchiveWrittenResult<Document>> {
	return writePhotoCatalogArchiveKernel(root, photos, identity, prepare, options, profile, maximumStreamingOutputBytes);
}

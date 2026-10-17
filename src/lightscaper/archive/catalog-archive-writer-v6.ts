/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_PACK_ENCODING_V3 } from '../../common/editor/scape-photo-catalog-pack-v3.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { encodePhotoCatalogPackV3, type PhotoCatalogPackInputV3 } from './catalog-pack-v3.ts';
import { PhotoCatalogPackSequenceV3 } from './catalog-pack-sequence-v3.ts';
import { maximumPhotoCatalogStreamingOutputBytesV6 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchiveKernel, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchivePrepare,
	type PhotoCatalogArchiveWrittenResult, type PhotoCatalogArchiveWriterProfile } from './catalog-archive-writer-kernel.ts';
export type { PhotoCatalogArchiveExportOptions, PhotoCatalogArchivePackWriter, PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-kernel.ts';

const profile = Object.freeze<PhotoCatalogArchiveWriterProfile>({ encoding: PHOTO_CATALOG_PACK_ENCODING_V3, schemaVersion: 6,
	maximumStreamingOutputBytes: maximumPhotoCatalogStreamingOutputBytesV6(), encode: encodePhotoCatalogPackV3,
	sequence: (photos, identity, signal) => new PhotoCatalogPackSequenceV3(photos, identity, signal) });
export function writePhotoCatalogArchiveV6<Document>(root: PhotoCatalogRootV1,
	photos: Iterable<PhotoCatalogPackInputV3> | AsyncIterable<PhotoCatalogPackInputV3>, identity: PhotoCatalogArchiveIdentityGuard,
	prepare: PhotoCatalogArchivePrepare<Document, 6>, options: PhotoCatalogArchiveExportOptions = {},
	maximumStreamingOutputBytes = maximumPhotoCatalogStreamingOutputBytesV6()): Promise<PhotoCatalogArchiveWrittenResult<Document>> {
	return writePhotoCatalogArchiveKernel(root, photos, identity, prepare, options, profile, maximumStreamingOutputBytes);
}

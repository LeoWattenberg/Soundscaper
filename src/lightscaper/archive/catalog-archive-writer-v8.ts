/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_PACK_ENCODING_V4 } from '../../common/editor/scape-photo-catalog-pack-v4.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoCatalogArchiveIdentityGuard } from './catalog-archive-contract.ts';
import { encodePhotoCatalogPackCurrentV1, type PhotoCatalogPackInputCurrentV1 } from './catalog-pack-current-v1.ts';
import { PhotoCatalogPackSequenceCurrentV1 } from './catalog-pack-sequence-current-v1.ts';
import { maximumPhotoCatalogStreamingOutputBytesV6 } from './catalog-archive-capacity.ts';
import { writePhotoCatalogArchiveKernel, type PhotoCatalogArchiveExportOptions, type PhotoCatalogArchivePrepare,
	type PhotoCatalogArchiveWrittenResult, type PhotoCatalogArchiveWriterProfile } from './catalog-archive-writer-kernel.ts';

const profile = Object.freeze<PhotoCatalogArchiveWriterProfile<'current4'>>({ encoding: PHOTO_CATALOG_PACK_ENCODING_V4, schemaVersion: 8,
	maximumStreamingOutputBytes: maximumPhotoCatalogStreamingOutputBytesV6(), encode: encodePhotoCatalogPackCurrentV1,
	sequence: (photos, identity, signal) => new PhotoCatalogPackSequenceCurrentV1(photos, identity, signal) });
export function writePhotoCatalogArchiveV8<Document>(root: PhotoCatalogRootV1,
	photos: Iterable<PhotoCatalogPackInputCurrentV1> | AsyncIterable<PhotoCatalogPackInputCurrentV1>, identity: PhotoCatalogArchiveIdentityGuard,
	prepare: PhotoCatalogArchivePrepare<Document, 8>, options: PhotoCatalogArchiveExportOptions = {},
	maximumStreamingOutputBytes = maximumPhotoCatalogStreamingOutputBytesV6()): Promise<PhotoCatalogArchiveWrittenResult<Document>> {
	return writePhotoCatalogArchiveKernel(root, photos, identity, prepare, options, profile, maximumStreamingOutputBytes);
}

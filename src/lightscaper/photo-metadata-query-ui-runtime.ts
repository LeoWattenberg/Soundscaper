/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoMetadataQueryRuntimeV2 } from '../common/editor/photo-library-query-port-v2.ts';
import { PHOTO_METADATA_QUERY_COLUMNS_V2 } from './catalog/photo-metadata-query-columns-v2.ts';
import { normalizePhotoSmartQueryV2 } from './catalog/photo-smart-query-v2.ts';

export const PHOTO_METADATA_QUERY_RUNTIME_V2: PhotoMetadataQueryRuntimeV2 = Object.freeze({ columns: PHOTO_METADATA_QUERY_COLUMNS_V2,
	normalizePredicate: (value: unknown) => normalizePhotoSmartQueryV2({ schemaVersion: 2, kind: 'photo-smart-query', predicate: value }).predicate });

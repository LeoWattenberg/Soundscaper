/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoSavedFilterRuntimeV1 } from '../common/editor/photo-library-saved-filter-runtime-v1.ts';
import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 } from '../common/editor/photo-library-saved-collection-port-v1.ts';
import { migratePhotoCatalogQueryV1ToV2, normalizePhotoCatalogQueryV2 } from './catalog/photo-query-types-v2.ts';
import { record } from './catalog/value-validation.ts';
import { PHOTO_METADATA_QUERY_RUNTIME_V2 } from './photo-metadata-query-ui-runtime.ts';

const fields = ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate'] as const;

/** Pure full-query codecs; no Session, database or original media is acquired. */
export const PHOTO_SAVED_FILTER_RUNTIME_V1: PhotoSavedFilterRuntimeV1 = Object.freeze({
	...PHOTO_METADATA_QUERY_RUNTIME_V2,
	readQueryJson(value: unknown) {
		if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1.maximumQueryJsonBytes) {
			throw new RangeError('Saved filter JSON exceeds its 512 KiB bound.');
		}
		return normalizePhotoCatalogQueryV2(record(JSON.parse(value) as unknown, 'complete saved filter', fields));
	},
	writeQueryJson(value: Parameters<PhotoSavedFilterRuntimeV1['writeQueryJson']>[0]) {
		const input = record(value, 'saved filter draft', fields, ['text', 'filter', 'sort']);
		const query = Object.hasOwn(input, 'schemaVersion')
			? normalizePhotoCatalogQueryV2(record(input, 'complete saved filter draft', fields))
			: migratePhotoCatalogQueryV1ToV2(record(input, 'transient filter', ['text', 'filter', 'sort']));
		// The owning Query2 normalizer enforces this same bound after canonicalization.
		return JSON.stringify(query);
	},
});

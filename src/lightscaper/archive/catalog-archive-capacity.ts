/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../../common/editor/scape-archive-limits.ts';
import { maximumScapeStoreArchiveBytes } from '../../common/editor/scape-export-estimate.ts';

/** Capacity admission is independent of loading the ZIP writer or catalog bodies. */
export function maximumPhotoCatalogStreamingOutputBytesV1(): number {
	return maximumForPackEntry('photo-pack');
}

/** Saved-definition entry names are longer; payload and entry ceilings are unchanged. */
export function maximumPhotoCatalogStreamingOutputBytesV3(): number {
	return maximumForPackEntry('saved-collection-pack');
}

function maximumForPackEntry(prefix: string): number {
	const entries = Array.from({ length: SCAPE_ARCHIVE_LIMITS.maximumEntryCount }, (_, index) => ({
		filename: `assets/${prefix}-${String(index).padStart(6, '0')}.bin`,
		payloadBytes: index === 0 ? SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes : 0,
	}));
	return maximumScapeStoreArchiveBytes(entries);
}

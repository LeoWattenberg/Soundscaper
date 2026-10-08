/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from '../../common/editor/scape-archive-limits.ts';
import { maximumScapeStoreArchiveBytes } from '../../common/editor/scape-export-estimate.ts';

/** Capacity admission is independent of loading the ZIP writer or catalog bodies. */
export function maximumPhotoCatalogStreamingOutputBytesV1(): number {
	const entries = Array.from({ length: SCAPE_ARCHIVE_LIMITS.maximumEntryCount }, (_, index) => ({
		filename: `assets/photo-pack-${String(index).padStart(6, '0')}.bin`,
		payloadBytes: index === 0 ? SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes : 0,
	}));
	return maximumScapeStoreArchiveBytes(entries);
}

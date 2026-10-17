/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { normalizePhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../../src/lightscaper/storage/photo-raster-export-journal-v1.ts';

/** Observe the actual retained queue without changing its facts or ACKs. */
export async function readPhotoRasterBatchGraphicJournalFixture() {
	const session = await createPhotoLibrarySessionV3({ name: 'Observe retained graphic export queue' });
	try {
		if (!session.exportJournal) throw new Error('The current library has no export journal capability.');
		const access = await session.exportJournal.open();
		const raw = await access.settings.get(photoRasterExportJournalKeyV1(access.catalogId));
		return raw === undefined ? null : normalizePhotoRasterExportJournalV1(raw);
	} finally { await session.close(); }
}

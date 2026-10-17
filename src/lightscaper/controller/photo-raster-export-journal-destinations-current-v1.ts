/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportBatchCurrentV1 } from './photo-raster-export-batch-current-v1.ts';
import type { PhotoRasterExportBatchDestinations } from './photo-raster-export-batch-queue.ts';
import type { PhotoRasterExportJournalOwnerCurrentV1 } from '../storage/photo-raster-export-journal-owner-current-v1.ts';
import { assertPhotoRasterJournalPlanForProfileV1, createPhotoRasterJournalDestinationsForProfileV1,
	type PhotoRasterJournalDestinationsV1 } from './internal/photo-raster-export-journal-destinations-kernel-v1.ts';

export function assertPhotoRasterJournalPlanCurrentV1(plan: Readonly<PhotoRasterExportBatchCurrentV1>, owner: PhotoRasterExportJournalOwnerCurrentV1): void {
	assertPhotoRasterJournalPlanForProfileV1('current3', plan, owner);
}
export function createPhotoRasterJournalDestinationsCurrentV1(plan: Readonly<PhotoRasterExportBatchCurrentV1>, journal: PhotoRasterExportJournalOwnerCurrentV1,
	acquire: () => PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>,
	options: Readonly<{ reviewedRetryJobIds?: readonly string[] }> = {}): Promise<Readonly<PhotoRasterJournalDestinationsV1>> {
	return createPhotoRasterJournalDestinationsForProfileV1('current3', plan, journal, acquire, options);
}

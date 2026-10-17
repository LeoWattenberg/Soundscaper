/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportBatchV1 } from './photo-raster-export-batch-v1.ts';
import type { PhotoRasterExportBatchDestinations } from './photo-raster-export-batch-queue.ts';
import type { PhotoRasterExportJournalOwnerV1 } from '../storage/photo-raster-export-journal-owner-v1.ts';
import { assertPhotoRasterJournalPlanForProfileV1, createPhotoRasterJournalDestinationsForProfileV1,
	type PhotoRasterJournalDestinationsV1 } from './internal/photo-raster-export-journal-destinations-kernel-v1.ts';
export { PhotoRasterJournalDestinationErrorV1 } from './internal/photo-raster-export-journal-destinations-kernel-v1.ts';
export type { PhotoRasterJournalDestinationReceiptV1, PhotoRasterJournalDestinationsV1 } from './internal/photo-raster-export-journal-destinations-kernel-v1.ts';

export function assertPhotoRasterJournalPlanV1(plan: Readonly<PhotoRasterExportBatchV1>, owner: PhotoRasterExportJournalOwnerV1): void {
	assertPhotoRasterJournalPlanForProfileV1('legacy2', plan, owner);
}
export function createPhotoRasterJournalDestinationsV1(plan: Readonly<PhotoRasterExportBatchV1>, journal: PhotoRasterExportJournalOwnerV1,
	acquire: () => PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>,
	options: Readonly<{ reviewedRetryJobIds?: readonly string[] }> = {}): Promise<Readonly<PhotoRasterJournalDestinationsV1>> {
	return createPhotoRasterJournalDestinationsForProfileV1('legacy2', plan, journal, acquire, options);
}

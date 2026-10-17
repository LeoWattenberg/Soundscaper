/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoHistoryForProfileV1, commitPhotoHistoryForProfileV1, undoPhotoHistoryForProfileV1, redoPhotoHistoryForProfileV1,
	createPhotoVersionForProfileV1, type PhotoHistoryForProfileV1 } from './photo-history-kernel.ts';
import type { PhotoDocumentV1 } from './types.ts';
import type { PhotoDocumentV2 } from './photo-document-v2.ts';

export type PhotoHistoryV2 = PhotoHistoryForProfileV1<'legacy2'>;
/** Permanently fixed legacy2 facade over the shared bounded history owner. */
export function createPhotoHistoryV2(value: unknown, capacity = 20): PhotoHistoryV2 {
	return createPhotoHistoryForProfileV1('legacy2', value, capacity);
}
export function commitPhotoHistoryV2(history: PhotoHistoryV2, value: unknown): PhotoHistoryV2 {
	return commitPhotoHistoryForProfileV1('legacy2', history, value);
}
export function undoPhotoHistoryV2(history: PhotoHistoryV2): PhotoHistoryV2 {
	return undoPhotoHistoryForProfileV1('legacy2', history);
}
export function redoPhotoHistoryV2(history: PhotoHistoryV2): PhotoHistoryV2 {
	return redoPhotoHistoryForProfileV1('legacy2', history);
}
export function createPhotoVersionV2(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string; sourceVersionId?: string }>): PhotoDocumentV1 | PhotoDocumentV2 {
	return createPhotoVersionForProfileV1('legacy2', value, request);
}

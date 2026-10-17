/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoHistoryForProfileV1, commitPhotoHistoryForProfileV1, undoPhotoHistoryForProfileV1, redoPhotoHistoryForProfileV1,
	createPhotoVersionForProfileV1, type PhotoHistoryForProfileV1 } from './photo-history-kernel.ts';
import type { PhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';

export type PhotoHistoryCurrentV1 = PhotoHistoryForProfileV1<'current4'>;
/** Named Current admission over the shared bounded history owner. */
export function createPhotoHistoryCurrentV1(value: unknown, capacity = 20): PhotoHistoryCurrentV1 {
	return createPhotoHistoryForProfileV1('current4', value, capacity);
}
export function commitPhotoHistoryCurrentV1(history: PhotoHistoryCurrentV1, value: unknown): PhotoHistoryCurrentV1 {
	return commitPhotoHistoryForProfileV1('current4', history, value);
}
export function undoPhotoHistoryCurrentV1(history: PhotoHistoryCurrentV1): PhotoHistoryCurrentV1 {
	return undoPhotoHistoryForProfileV1('current4', history);
}
export function redoPhotoHistoryCurrentV1(history: PhotoHistoryCurrentV1): PhotoHistoryCurrentV1 {
	return redoPhotoHistoryForProfileV1('current4', history);
}
export function createPhotoVersionCurrentV1(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string; sourceVersionId?: string }>): PhotoDocumentCurrentV1 {
	return createPhotoVersionForProfileV1('current4', value, request);
}

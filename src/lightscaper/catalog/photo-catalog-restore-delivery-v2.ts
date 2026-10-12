/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRestoreDeliveryForProfileV1, type PhotoCatalogRestoreDeliveredDocumentForProfileV1 } from './internal/photo-catalog-restore-records-kernel-v1.ts';
export type PhotoCatalogRestoreDeliveredDocumentV2 = PhotoCatalogRestoreDeliveredDocumentForProfileV1<'legacy2'>;
/** The permanent legacy owner preserves full strict Photo1/2 delivery. */
export class PhotoCatalogRestoreDeliveryV2 extends PhotoCatalogRestoreDeliveryForProfileV1<'legacy2'> {
	constructor(catalogId: string, maximumBytes?: number) { super('legacy2', catalogId, maximumBytes); }
}

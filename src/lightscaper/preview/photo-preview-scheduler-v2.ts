/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { PHOTO_PREVIEW_PROTOCOL_V1 } from './photo-preview-protocol-v1.ts';
import { PhotoPreviewSchedulerCore, type PhotoPreviewSchedulerOptionsCore } from './photo-preview-scheduler-core.ts';
export type PhotoPreviewSchedulerOptionsV2 = PhotoPreviewSchedulerOptionsCore;

/** Current photos share original-only preview bytes, keys and bounded lifetime machinery. */
export class PhotoPreviewSchedulerV2 extends PhotoPreviewSchedulerCore {
	constructor(options: PhotoPreviewSchedulerOptionsV2) {
		super(options, normalizePhotoDocumentV1OrV2, PHOTO_PREVIEW_PROTOCOL_V1);
	}
}

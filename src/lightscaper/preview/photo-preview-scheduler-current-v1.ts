/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoPreviewSchedulerCore, type PhotoPreviewSchedulerOptionsCore } from './photo-preview-scheduler-core.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
export type PhotoPreviewSchedulerOptionsCurrentV1 = PhotoPreviewSchedulerOptionsCore;

/** Current recipes share the original-only cache identity, queue and joined native lifetime. */
export class PhotoPreviewSchedulerCurrentV1 extends PhotoPreviewSchedulerCore {
	constructor(options: PhotoPreviewSchedulerOptionsCurrentV1) {
		super(options, normalizePhotoDocumentCurrentV1);
	}
}

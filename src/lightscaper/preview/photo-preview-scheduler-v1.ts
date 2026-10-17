/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { PHOTO_PREVIEW_PROTOCOL_V1 } from './photo-preview-protocol-v1.ts';
import { PhotoPreviewSchedulerCore, type PhotoPreviewSchedulerOptionsCore } from './photo-preview-scheduler-core.ts';
export { PHOTO_PREVIEW_SCHEDULER_LIMITS_V1 } from './photo-preview-scheduler-core.ts';
export type { PhotoPreviewJobOutcomeV1 } from './photo-preview-scheduler-core.ts';
export type PhotoPreviewSchedulerOptionsV1 = PhotoPreviewSchedulerOptionsCore;

/** The legacy queue keeps its exact named Photo1 admission and original-only cache policy. */
export class PhotoPreviewSchedulerV1 extends PhotoPreviewSchedulerCore {
	constructor(options: PhotoPreviewSchedulerOptionsV1) {
		super(options, value => {
			const photo = validateLightscaperDocumentV1(value);
			if (photo.kind !== 'photo') throw new TypeError('Photo preview requires one photo document.');
			return photo;
		}, PHOTO_PREVIEW_PROTOCOL_V1);
	}
}

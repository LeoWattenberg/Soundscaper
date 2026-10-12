/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoMediaRestoreCandidateForProfileV1, type PhotoMediaRestoreCandidateOptionsForProfileV1, type PhotoMediaRestoreCandidateV2 } from './internal/photo-media-restore-candidate-kernel-v1.ts';
import type { PhotoMediaRestorePresetHeaderV2 } from './photo-media-restore-presets-v2.ts';
export type { PhotoMediaRestoreOriginalReceiptV1, PhotoMediaRestoreReceiptV2, PhotoMediaRestoreCandidateV2 } from './internal/photo-media-restore-candidate-kernel-v1.ts';
export interface PhotoMediaRestoreCandidateOptionsV2 extends Omit<PhotoMediaRestoreCandidateOptionsForProfileV1, 'developPresets'> {
	readonly developPresets?: PhotoMediaRestorePresetHeaderV2 | null;
}
export function createPhotoMediaRestoreCandidateV2(value: PhotoMediaRestoreCandidateOptionsV2): Promise<PhotoMediaRestoreCandidateV2> {
	return createPhotoMediaRestoreCandidateForProfileV1('legacy2', value);
}

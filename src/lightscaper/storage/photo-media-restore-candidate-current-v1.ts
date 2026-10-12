/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoMediaRestoreCandidateForProfileV1, type PhotoMediaRestoreCandidateOptionsForProfileV1, type PhotoMediaRestoreCandidateV2 } from './internal/photo-media-restore-candidate-kernel-v1.ts';
export type PhotoMediaRestoreCandidateOptionsCurrentV1 = PhotoMediaRestoreCandidateOptionsForProfileV1;
export type PhotoMediaRestoreCandidateCurrentV1 = PhotoMediaRestoreCandidateV2;
export function createPhotoMediaRestoreCandidateCurrentV1(value: PhotoMediaRestoreCandidateOptionsCurrentV1): Promise<PhotoMediaRestoreCandidateCurrentV1> {
	return createPhotoMediaRestoreCandidateForProfileV1('current3', value);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1 } from '../../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import type { PhotoLibraryPreviewTierV1, PhotoLibraryPreviewOutcomeV1 } from '../../../common/editor/photo-library-session-port-v1.ts';
import { id, oneOf } from '../../catalog/value-validation.ts';
import type { PhotoPreviewJobOutcomeV1, PhotoPreviewPreparedCore } from '../../preview/photo-preview-scheduler-core.ts';

/** The permanent Session keeps its closed signal-only options. Current source
 * preference is scalar culling policy and never modifies saved Develop. */
export function preparePhotoLibraryPreviewReadKernelV2(current: boolean, photo: string, tierValue: PhotoLibraryPreviewTierV1, options: unknown) {
	const input = record(options, 'photo preview read options', current ? ['signal', 'rawPreviewSource'] : ['signal'], []);
	const photoId = id(photo, 'photo ID'), tier = oneOf(tierValue, ['thumbnail', 'fit-screen'] as const, 'preview tier');
	const signal = Object.hasOwn(input, 'signal') ? captureRepairSignalV1(field(input, 'signal', 'photo preview read options')) : undefined;
	const rawPreviewSource = current && Object.hasOwn(input, 'rawPreviewSource') ? oneOf(field(input, 'rawPreviewSource', 'photo preview read options'),
		['neutral-original', 'camera-embedded'] as const, 'RAW preview source') : undefined;
	return Object.freeze({ photoId, tier, ...(signal ? { signal } : {}), ...(rawPreviewSource === undefined ? {} : { rawPreviewSource }) });
}

/** Deliver original-free display bytes through the existing presentation port. */
export function projectPhotoLibraryPreviewOutcomeKernelV2(result: PhotoPreviewJobOutcomeV1<PhotoPreviewPreparedCore>,
	photoId: string, tier: PhotoLibraryPreviewTierV1): PhotoLibraryPreviewOutcomeV1 {
	if (result.outcome !== 'ready') return Object.freeze({ outcome: result.outcome });
	const notices: Array<'persistence-failed' | 'cleanup-failed'> = [];
	if (result.cache === 'transient' || result.persistenceError !== undefined) notices.push('persistence-failed');
	if (result.cleanupErrors?.length) notices.push('cleanup-failed');
	return Object.freeze({ outcome: 'ready', cache: result.cache, notices: Object.freeze(notices),
		preview: Object.freeze({ photoId, tier, descriptor: result.preview.descriptor,
			byteLength: result.preview.byteLength, outputSha256: result.preview.outputSha256, body: result.preview.body }) });
}

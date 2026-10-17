/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoPreviewSchedulerCore, type PhotoPreviewSchedulerOptionsCore } from './photo-preview-scheduler-core.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { createPhotoPreviewProtocolCurrentV1, type PreparedPhotoPreviewCurrentV1, type PhotoPreviewPlanCurrentV1 } from './photo-preview-protocol-current-v1.ts';
import { createPhotoPreviewCacheRouteCurrentV1 } from './photo-preview-cache-route-current-v1.ts';
import type { PhotoCullingPreviewCachePortCurrentV1 } from './photo-culling-preview-cache-current-v1.ts';
import type { PhotoHdrPreviewCachePortCurrentV1 } from './photo-hdr-preview-cache-current-v1.ts';
import type { withPhotoCullingFrameCurrentV1 } from './photo-culling-frame-current-v1.ts';
import { withPhotoPreviewOriginalFrameCurrentV1, type withPhotoOriginalFrameCurrentV1 } from './photo-original-frame-current-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoOriginalFrameProvenanceV1 } from './photo-original-frame-v1.ts';
export interface PhotoPreviewSchedulerOptionsCurrentV1 extends PhotoPreviewSchedulerOptionsCore {
	readonly cullingCache?: PhotoCullingPreviewCachePortCurrentV1;
	readonly regenerateCulling?: typeof withPhotoCullingFrameCurrentV1;
	readonly hdrCache?: PhotoHdrPreviewCachePortCurrentV1;
	readonly regenerateHdr?: typeof withPhotoOriginalFrameCurrentV1;
}

/** Current source variants share one queue and joined native lifetime, with distinct cache recipes. */
export class PhotoPreviewSchedulerCurrentV1 extends PhotoPreviewSchedulerCore<PreparedPhotoPreviewCurrentV1, PhotoPreviewPlanCurrentV1> {
	constructor(options: PhotoPreviewSchedulerOptionsCurrentV1) {
		const input = record(options, 'Current preview scheduler ports', ['catalogId', 'loadPhoto', 'loadOriginal', 'cache', 'regenerate', 'cullingCache', 'regenerateCulling', 'hdrCache', 'regenerateHdr'],
			['catalogId', 'loadPhoto', 'loadOriginal', 'cache']);
		const photo = field(input, 'loadPhoto', 'Current preview scheduler ports'), original = field(input, 'loadOriginal', 'Current preview scheduler ports');
		const regenerate = Object.hasOwn(input, 'regenerate') ? field(input, 'regenerate', 'Current preview scheduler ports') : undefined;
		if (typeof photo !== 'function' || typeof original !== 'function' || (regenerate !== undefined && typeof regenerate !== 'function')) {
			throw new TypeError('Current preview requires inert read capabilities.');
		}
		const cullingCache = Object.hasOwn(input, 'cullingCache') ? field(input, 'cullingCache', 'Current preview scheduler ports') as PhotoCullingPreviewCachePortCurrentV1 | undefined : undefined;
		const regenerateCulling = Object.hasOwn(input, 'regenerateCulling') ? field(input, 'regenerateCulling', 'Current preview scheduler ports') : undefined;
		if (regenerateCulling !== undefined && typeof regenerateCulling !== 'function') throw new TypeError('Current camera culling requires an inert producer capability.');
		const hdrCache = Object.hasOwn(input, 'hdrCache') ? field(input, 'hdrCache', 'Current preview scheduler ports') as PhotoHdrPreviewCachePortCurrentV1 | undefined : undefined;
		const regenerateHdr = Object.hasOwn(input, 'regenerateHdr') ? field(input, 'regenerateHdr', 'Current preview scheduler ports') : undefined;
		if (regenerateHdr !== undefined && typeof regenerateHdr !== 'function') throw new TypeError('Current HDR previews require an inert producer capability.');
		const cache = createPhotoPreviewCacheRouteCurrentV1(field(input, 'cache', 'Current preview scheduler ports') as PhotoPreviewSchedulerOptionsCore['cache'], cullingCache, hdrCache);
		super({ catalogId: field(input, 'catalogId', 'Current preview scheduler ports') as string,
			loadPhoto: (...args) => Reflect.apply(photo, options, args) as ReturnType<PhotoPreviewSchedulerOptionsCore['loadPhoto']>,
			loadOriginal: (...args) => Reflect.apply(original, options, args) as ReturnType<PhotoPreviewSchedulerOptionsCore['loadOriginal']>,
			cache,
				regenerate: regenerate ? <Result>(value: unknown, consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>) =>
					Reflect.apply(regenerate, options, [value, consume]) as Promise<Result>
				: withPhotoPreviewOriginalFrameCurrentV1 }, normalizePhotoDocumentCurrentV1, createPhotoPreviewProtocolCurrentV1(options,
				regenerateCulling as typeof withPhotoCullingFrameCurrentV1 | undefined, regenerateHdr as typeof withPhotoOriginalFrameCurrentV1 | undefined));
	}
}

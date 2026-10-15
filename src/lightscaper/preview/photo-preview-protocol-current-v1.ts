/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { oneOf } from '../catalog/value-validation.ts';
import { PHOTO_PREVIEW_PROTOCOL_V1 } from './photo-preview-protocol-v1.ts';
import { planPhotoCullingPreviewCurrentV1, type PhotoCullingPreviewPlanCurrentV1 } from './photo-culling-preview-plan-current-v1.ts';
import { preparePhotoCullingPreviewCurrentV1, type PreparedPhotoCullingPreviewCurrentV1 } from './photo-culling-preview-preparation-current-v1.ts';
import type { PhotoPreviewPlanV1 } from './photo-preview-plan-v1.ts';
import type { PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';
import type { PhotoPreviewProtocolCore } from './photo-preview-scheduler-core.ts';
import type { withPhotoCullingFrameCurrentV1 } from './photo-culling-frame-current-v1.ts';

export type PhotoPreviewPlanCurrentV1 = PhotoPreviewPlanV1 | PhotoCullingPreviewPlanCurrentV1;
export type PreparedPhotoPreviewCurrentV1 = PreparedPhotoPreviewV1 | PreparedPhotoCullingPreviewCurrentV1;

/** Both source choices share one bounded demand queue. Ordinary raster and the
 * neutral default retain the exact permanent Original recipe and cache. */
export function createPhotoPreviewProtocolCurrentV1(receiver: object, configured?: typeof withPhotoCullingFrameCurrentV1):
Readonly<PhotoPreviewProtocolCore<PreparedPhotoPreviewCurrentV1, PhotoPreviewPlanCurrentV1>> {
	return Object.freeze<PhotoPreviewProtocolCore<PreparedPhotoPreviewCurrentV1, PhotoPreviewPlanCurrentV1>>({
		capture(value) {
			const input = record(value, 'Current culling job', ['photoId', 'tier', 'signal', 'rawPreviewSource'], ['photoId', 'tier']);
			const old = PHOTO_PREVIEW_PROTOCOL_V1.capture({ photoId: field(input, 'photoId', 'Current culling job'),
				tier: field(input, 'tier', 'Current culling job'), ...(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'Current culling job') } : {}) });
			const variant = Object.hasOwn(input, 'rawPreviewSource') ? oneOf(field(input, 'rawPreviewSource', 'Current culling job'),
				['neutral-original', 'camera-embedded'] as const, 'RAW preview source') : 'neutral-original';
			return Object.freeze({ ...old, variant });
		},
		plan(binding, tier, photo, variant) {
			return variant === 'camera-embedded' && ['image/x-adobe-dng', 'image/x-canon-crw'].includes(photo.original.mimeType)
				? planPhotoCullingPreviewCurrentV1({ binding, tier, source: 'camera-embedded' })
				: PHOTO_PREVIEW_PROTOCOL_V1.plan(binding, tier, photo, '');
		},
		async render({ plan, binding, body, signal, variant }, regenerate) {
			if (plan.kind === 'photo-preview-plan') return PHOTO_PREVIEW_PROTOCOL_V1.render({ plan, binding, body, signal, variant }, regenerate);
			const produce = configured ?? (await import('./photo-culling-frame-current-v1.ts')).withPhotoCullingFrameCurrentV1;
			return Reflect.apply(produce, receiver, [{ binding, body, source: 'camera-embedded', signal },
				(frame: Parameters<Parameters<typeof withPhotoCullingFrameCurrentV1>[1]>[0], provenance: Parameters<Parameters<typeof withPhotoCullingFrameCurrentV1>[1]>[1]) =>
					preparePhotoCullingPreviewCurrentV1({ plan, binding, frame, signal, representation: provenance.representation })]) as Promise<Readonly<PreparedPhotoCullingPreviewCurrentV1>>;
		},
	});
}

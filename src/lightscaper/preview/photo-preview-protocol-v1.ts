/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { id, oneOf } from '../catalog/value-validation.ts';
import { planPhotoPreviewV1, type PhotoPreviewPlanV1 } from './photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1, type PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';
import type { PhotoPreviewProtocolCore } from './photo-preview-scheduler-core.ts';

/** Permanent Original-only recipe. Current camera preference cannot enter this
 * request reader, source admission, pixel preparation or cache identity. */
export const PHOTO_PREVIEW_PROTOCOL_V1: Readonly<PhotoPreviewProtocolCore<PreparedPhotoPreviewV1, PhotoPreviewPlanV1>> = Object.freeze<PhotoPreviewProtocolCore<PreparedPhotoPreviewV1, PhotoPreviewPlanV1>>({
	capture(value) {
		const input = record(value, 'photo preview job', ['photoId', 'tier', 'signal'], ['photoId', 'tier']);
		const photoId = id(field(input, 'photoId', 'photo preview job'), 'preview photo ID');
		const tier = oneOf(field(input, 'tier', 'photo preview job'), ['thumbnail', 'fit-screen'] as const, 'preview tier');
		const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo preview job') : undefined;
		if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo preview jobs require a cancellation signal.');
		return Object.freeze({ photoId, tier, ...(signal ? { signal } : {}), variant: '' });
	},
	plan(binding, tier) { return planPhotoPreviewV1({ binding, source: { schemaVersion: 1, width: binding.width, height: binding.height,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, tier }); },
	render({ plan, binding, body, signal }, regenerate) {
		return regenerate({ binding, body, signal }, frame => preparePhotoPreviewV1({ plan, binding, frame, signal }));
	},
});

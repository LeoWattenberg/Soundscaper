/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoPreviewSchedulerCore, type PhotoPreviewSchedulerOptionsCore } from './photo-preview-scheduler-core.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { withPhotoPreviewOriginalFrameCurrentV1 } from './photo-original-frame-current-v1.ts';
import type { PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoOriginalFrameProvenanceV1 } from './photo-original-frame-v1.ts';
export type PhotoPreviewSchedulerOptionsCurrentV1 = PhotoPreviewSchedulerOptionsCore;

/** Current recipes share the original-only cache identity, queue and joined native lifetime. */
export class PhotoPreviewSchedulerCurrentV1 extends PhotoPreviewSchedulerCore {
	constructor(options: PhotoPreviewSchedulerOptionsCurrentV1) {
		const input = record(options, 'Current preview scheduler ports', ['catalogId', 'loadPhoto', 'loadOriginal', 'cache', 'regenerate'],
			['catalogId', 'loadPhoto', 'loadOriginal', 'cache']);
		const photo = field(input, 'loadPhoto', 'Current preview scheduler ports'), original = field(input, 'loadOriginal', 'Current preview scheduler ports');
		const regenerate = Object.hasOwn(input, 'regenerate') ? field(input, 'regenerate', 'Current preview scheduler ports') : undefined;
		if (typeof photo !== 'function' || typeof original !== 'function' || (regenerate !== undefined && typeof regenerate !== 'function')) {
			throw new TypeError('Current preview requires inert read capabilities.');
		}
		super({ catalogId: field(input, 'catalogId', 'Current preview scheduler ports') as string,
			loadPhoto: (...args) => Reflect.apply(photo, options, args) as ReturnType<PhotoPreviewSchedulerOptionsCore['loadPhoto']>,
			loadOriginal: (...args) => Reflect.apply(original, options, args) as ReturnType<PhotoPreviewSchedulerOptionsCore['loadOriginal']>,
			cache: field(input, 'cache', 'Current preview scheduler ports') as PhotoPreviewSchedulerOptionsCore['cache'],
				regenerate: regenerate ? <Result>(value: unknown, consume: (frame: PixelFrameV1, provenance: Readonly<PhotoOriginalFrameProvenanceV1>) => Promise<Result>) =>
					Reflect.apply(regenerate, options, [value, consume]) as Promise<Result>
				: withPhotoPreviewOriginalFrameCurrentV1 }, normalizePhotoDocumentCurrentV1);
	}
}

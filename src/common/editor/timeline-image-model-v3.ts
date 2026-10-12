/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperEditableImageSourceForProfileV1, type FramescaperEditableImageSourceForProfileV1 } from './internal/timeline-image-model-editable-kernel-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1, type ImageDevelopResourceReferencesCurrentV1 } from './imaging/image-develop-resource-reachability-current-v1.ts';

export type FramescaperImageSourceV3 = FramescaperEditableImageSourceForProfileV1<'current3'>;
/** Full Current metadata stays beside the unchanged canonical Original pack. */
export function normalizeFramescaperImageSourceV3(value: unknown): Readonly<FramescaperImageSourceV3> {
	return normalizeFramescaperEditableImageSourceForProfileV1('current3', value);
}
export function framescaperImageSourceResourceReferencesV3(value: unknown): Readonly<ImageDevelopResourceReferencesCurrentV1> {
	const source = normalizeFramescaperImageSourceV3(value), closure = createImageDevelopResourceReachabilityCurrentV1();
	closure.addDevelop(source.develop); return closure.finish();
}

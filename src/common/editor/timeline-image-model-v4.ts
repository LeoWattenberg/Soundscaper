/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperRawImageSourceForProfileV1, type FramescaperRawImageSourceForProfileV1 } from './internal/timeline-image-model-raw-kernel-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1, type ImageDevelopResourceReferencesCurrentV1 } from './imaging/image-develop-resource-reachability-current-v1.ts';

export type FramescaperImageSourceV4 = FramescaperRawImageSourceForProfileV1<'current3'>;

/** Permanent Source4 admission retains recipes through3 and ABI1 authority. */
export function normalizeFramescaperImageSourceV4(value: unknown): Readonly<FramescaperImageSourceV4> {
	return normalizeFramescaperRawImageSourceForProfileV1('current3', value);
}

export function framescaperImageSourceResourceReferencesV4(value: unknown): Readonly<ImageDevelopResourceReferencesCurrentV1> {
	const source = normalizeFramescaperImageSourceV4(value), closure = createImageDevelopResourceReachabilityCurrentV1();
	closure.addDevelop(source.develop); return closure.finish();
}

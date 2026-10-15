/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField } from './closed-domain-value.ts';
import { normalizeFramescaperImageSourceV1, type FramescaperImageSourceV1 } from './timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2, type FramescaperImageSourceV2 } from './timeline-image-model-v2.ts';
import { normalizeFramescaperEditableImageSourceForProfileV1, type FramescaperEditableImageSourceForProfileV1 } from './internal/timeline-image-model-editable-kernel-v1.ts';
import { normalizeFramescaperRawImageSourceForProfileV1, type FramescaperRawImageSourceForProfileV1 } from './internal/timeline-image-model-raw-kernel-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1, type ImageDevelopResourceReferencesCurrentV1 } from './imaging/image-develop-resource-reachability-current-v1.ts';

export type FramescaperEditableImageSourceCurrentV1 = FramescaperEditableImageSourceForProfileV1<'current4'>;
export type FramescaperRawImageSourceCurrentV1 = FramescaperRawImageSourceForProfileV1<'current4'>;
export type FramescaperImageSourceCurrentV1 = FramescaperImageSourceV1 | FramescaperImageSourceV2 | FramescaperEditableImageSourceCurrentV1 | FramescaperRawImageSourceCurrentV1;
/** Dispatch from inert own metadata; Source1/2 are never promoted on read. */
export function normalizeFramescaperImageSourceCurrentV1(value: unknown): Readonly<FramescaperImageSourceCurrentV1> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper image source requires an own version.');
	const version = readClosedDomainField(value as Readonly<Record<string, unknown>>, 'schemaVersion', 'image source identity');
	if (version === 1) return normalizeFramescaperImageSourceV1(value);
	if (version === 2) return normalizeFramescaperImageSourceV2(value);
	if (version === 3) return normalizeFramescaperEditableImageSourceForProfileV1('current4', value);
	if (version === 4) return normalizeFramescaperRawImageSourceForProfileV1('current4', value);
	throw new RangeError('Unsupported Framescaper image source version.');
}
/** This current transport closure refuses unsupported input namespaces; it
 * grants no body proof and does not widen the old Source2 LUT-only helper. */
export function framescaperImageSourceResourceReferencesCurrentV1(value: unknown): Readonly<ImageDevelopResourceReferencesCurrentV1> {
	const source = normalizeFramescaperImageSourceCurrentV1(value), closure = createImageDevelopResourceReachabilityCurrentV1();
	if (source.schemaVersion === 2 && source.develop.masks.some(graph => graph.inputs.length !== 0)) {
		throw new TypeError('Source2 mask inputs require the explicit Source3 transport.');
	}
	if (source.schemaVersion !== 1) {
		closure.addDevelop(source.develop);
	}
	return closure.finish();
}

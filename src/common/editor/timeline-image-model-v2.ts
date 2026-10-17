/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeFramescaperImageSourceV1, type FramescaperImageSourceV1 } from './timeline-image-model.ts';
import { normalizeFramescaperEditableImageSourceForProfileV1, type FramescaperEditableImageSourceForProfileV1 } from './internal/timeline-image-model-editable-kernel-v1.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, prepareCubeLutProfileResourcePlanV1 } from './video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from './cube-lut-reference-contract.ts';
export type FramescaperImageSourceV2 = FramescaperEditableImageSourceForProfileV1<'legacy2'>;
/** Permanently strict Source2 admission. */
export function normalizeFramescaperImageSourceV2(value: unknown): Readonly<FramescaperImageSourceV2> {
	return normalizeFramescaperEditableImageSourceForProfileV1('legacy2', value);
}

/** Current consumers opt in to this dispatcher; the legacy V1 delegate is unchanged. */
export function normalizeFramescaperImageSourceV1OrV2(value: unknown): Readonly<FramescaperImageSourceV1 | FramescaperImageSourceV2> {
	if (!value || typeof value !== 'object') throw new TypeError('Framescaper image source requires an object.');
	const version = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!version || !Object.hasOwn(version, 'value')) throw new TypeError('Framescaper image source requires an own data version.');
	if (version.value === 1) return normalizeFramescaperImageSourceV1(value);
	if (version.value === 2) return normalizeFramescaperImageSourceV2(value);
	throw new RangeError('Unsupported Framescaper image source version.');
}

/** Disabled nonnull references remain required by persistence/transfer custody. */
export function framescaperImageSourceResourceReferencesV2(value: unknown): readonly Readonly<VideoCubeLutReferenceV1>[] {
	const source = normalizeFramescaperImageSourceV2(value), resources = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	for (const effect of source.develop.effects) {
		if (effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
		const reference = prepareCubeLutProfileResourcePlanV1(effect).reference;
		if (reference === null) continue;
		const previous = resources.get(reference.storageKey);
		if (previous && JSON.stringify(previous) !== JSON.stringify(reference)) throw new Error('Editable image resource references conflict.');
		resources.set(reference.storageKey, reference);
	}
	return Object.freeze([...resources.values()]);
}

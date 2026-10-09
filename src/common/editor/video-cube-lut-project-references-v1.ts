/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from './closed-domain-value.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, normalizeCubeLutProfileEffectV1 } from './video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from './video-color-cube-lut-v27.ts';

const MAXIMUM_REFERENCES = 16_384;

/** Collect custody from admitted current Frame records, including disabled
 * timeline/bin effects. Rendering requirements must never choose these roots.
 * Legacy asset-plan fixtures may omit clip collections; no schema admission
 * or body authentication is conferred by this bounded scalar closure. */
export function collectCubeLutProfileProjectReferencesV1(value: unknown): readonly Readonly<VideoCubeLutReferenceV1>[] {
	const project = object(value, 'Cube LUT project');
	const binValue = optional(project, 'projectBin');
	const references = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	const identities = new Map<string, string>();
	const collections = [optional(project, 'clips'), binValue === undefined ? undefined : optional(object(binValue, 'Cube LUT project bin'), 'clips')];
	for (const collection of collections) {
		if (collection === undefined) continue;
		for (const clip of readClosedDomainArray(collection, 'Cube LUT project clips', 0, 100_000)) {
			const effects = optional(object(clip, 'Cube LUT project clip'), 'videoEffects');
			if (effects === undefined) continue;
			for (const raw of readClosedDomainArray(effects, 'Cube LUT project effects', 0, 100_000)) {
				if (optional(object(raw, 'Cube LUT project effect'), 'type') !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
				const reference = normalizeCubeLutProfileEffectV1(raw).params.lut;
				if (reference === null) continue;
				const identity = JSON.stringify(reference);
				const previous = identities.get(reference.storageKey);
				if (previous !== undefined && previous !== identity) throw new RangeError('Cube LUT project references have conflicting identity.');
				identities.set(reference.storageKey, identity); references.set(reference.storageKey, reference);
				if (references.size > MAXIMUM_REFERENCES) throw new RangeError('Cube LUT project reference bound was exceeded.');
			}
		}
	}
	return Object.freeze([...references.values()]);
}

function object(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}
function optional(value: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`Cube LUT project ${key} must be an own enumerable data field.`);
	return descriptor.value;
}

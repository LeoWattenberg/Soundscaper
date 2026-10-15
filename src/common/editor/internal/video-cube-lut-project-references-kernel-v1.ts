/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../closed-domain-value.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1, normalizeCubeLutProfileEffectV1 } from '../video-cube-lut-profile-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../video-color-cube-lut-v27.ts';
import { normalizeFramescaperImageSourceV1OrV2, framescaperImageSourceResourceReferencesV2 } from '../timeline-image-model-v2.ts';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../timeline-image-model-current-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../imaging/brush-mask-resource-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1 } from '../imaging/image-develop-resource-reachability-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../imaging/image-develop-state-v2.ts';

const MAXIMUM_REFERENCES = 16_384;

/** Collect custody from admitted current Frame records, including disabled
 * timeline/bin effects. Rendering requirements must never choose these roots.
 * Legacy asset-plan fixtures may omit clip collections; no schema admission
 * or body authentication is conferred by this bounded scalar closure. */
export function collectCubeLutProjectResourcesForProfileV1(profile: 'legacy2' | 'current3', value: unknown) {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported project resource profile.');
	const project = object(value, 'Cube LUT project');
	const binValue = optional(project, 'projectBin');
	const references = new Map<string, Readonly<VideoCubeLutReferenceV1>>();
	const identities = new Map<string, string>(), brushes = new Map<string, Readonly<BrushMaskResourceReferenceV1>>();
	let currentTransport = false;
	const imageRecipes: unknown[] = [], clipRecipes: ReturnType<typeof normalizeCubeLutProfileEffectV1>[] = [];
	const sources = optional(project, 'sources');
	if (sources !== undefined) for (const raw of readClosedDomainArray(sources, 'Cube LUT project sources', 0, 100_000)) {
		const source = object(raw, 'Cube LUT project source');
		if (optional(source, 'kind') !== 'image' || optional(source, 'schemaVersion') === 1) continue;
		if (profile === 'legacy2') {
			const image = normalizeFramescaperImageSourceV1OrV2(source);
			if (image.schemaVersion === 2) for (const reference of framescaperImageSourceResourceReferencesV2(image)) add(reference);
		} else {
			const image = normalizeFramescaperImageSourceCurrentV1(source); currentTransport ||= image.schemaVersion === 3 || image.schemaVersion === 4;
			if (image.schemaVersion !== 1) imageRecipes.push(image.develop);
			const closure = framescaperImageSourceResourceReferencesCurrentV1(image);
			for (const reference of closure.luts) add(reference);
			for (const reference of closure.brushes) { identity(reference); brushes.set(reference.storageKey, reference); }
		}
	}
	const collections = [optional(project, 'clips'), binValue === undefined ? undefined : optional(object(binValue, 'Cube LUT project bin'), 'clips')];
	for (const collection of collections) {
		if (collection === undefined) continue;
		for (const clip of readClosedDomainArray(collection, 'Cube LUT project clips', 0, 100_000)) {
			const effects = optional(object(clip, 'Cube LUT project clip'), 'videoEffects');
			if (effects === undefined) continue;
			for (const raw of readClosedDomainArray(effects, 'Cube LUT project effects', 0, 100_000)) {
				if (optional(object(raw, 'Cube LUT project effect'), 'type') !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) continue;
				const effect = normalizeCubeLutProfileEffectV1(raw), reference = effect.params.lut;
				if (reference === null) continue;
				clipRecipes.push(effect); add(reference);
			}
		}
	}
	if (currentTransport) {
		// The actual Current owner checks cross-source SHA identity and the complete
		// combined scalar capacity before any native body admission. Clip effects
		// are admitted only as private computational resource declarations.
		const ledger = createImageDevelopResourceReachabilityCurrentV1();
		for (const develop of imageRecipes) ledger.addDevelop(develop);
		for (const effect of clipRecipes) ledger.addDevelop({ ...defaultImageDevelopStateV2(), effects: [effect] });
		return ledger.finish();
	}
	return Object.freeze({ luts: Object.freeze([...references.values()]), brushes: Object.freeze([...brushes.values()]) });
	function add(reference: Readonly<VideoCubeLutReferenceV1>): void {
		identity(reference); references.set(reference.storageKey, reference);
		if (references.size > MAXIMUM_REFERENCES) throw new RangeError('Cube LUT project reference bound was exceeded.');
	}
	function identity(reference: Readonly<VideoCubeLutReferenceV1 | BrushMaskResourceReferenceV1>): void {
		const value = JSON.stringify(reference), previous = identities.get(reference.storageKey);
		if (previous !== undefined && previous !== value) throw new RangeError('Current project resources have conflicting identity.');
		identities.set(reference.storageKey, value);
	}
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

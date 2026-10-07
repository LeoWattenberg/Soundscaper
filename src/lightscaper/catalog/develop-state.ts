/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoEffects } from '../../common/editor/video-effects.js';
import { normalizeVideoMaskMatteGraphV1 } from '../../common/editor/video-mask-matte-v24.ts';
import type { VideoEffectLeaf } from '../../common/editor/project-media-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDevelopV1, type PhotoGeometryV1 } from './types.ts';
import { array, boolean, compareText, field, id, number, record, unique } from './value-validation.ts';

export function normalizePhotoDevelopV1(value: unknown): PhotoDevelopV1 {
	const input = record(value, 'photo develop', ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings']);
	if (field(input, 'processVersion') !== 1) throw new RangeError('Unsupported photo develop process version.');
	const effects = normalizeEffects(field(input, 'effects'));
	const masks = array(field(input, 'masks'), 'photo masks', 0, LIMITS.maximumMasks)
		.map(normalizeVideoMaskMatteGraphV1).sort((left, right) => compareText(left.id, right.id));
	unique(masks.map((mask) => mask.id), 'photo masks');
	const effectIds = new Set(effects.map((effect) => effect.id));
	const maskIds = new Set(masks.map((mask) => mask.id));
	const bindings = array(field(input, 'maskBindings'), 'photo mask bindings', 0, LIMITS.maximumEffects).map((candidate) => {
		const binding = record(candidate, 'photo mask binding', ['effectId', 'maskId']);
		const effectId = id(field(binding, 'effectId'), 'mask binding effect ID');
		const maskId = id(field(binding, 'maskId'), 'mask binding mask ID');
		if (!effectIds.has(effectId) || !maskIds.has(maskId)) throw new ReferenceError('A photo mask binding references a missing effect or mask.');
		return Object.freeze({ effectId, maskId });
	}).sort((left, right) => compareText(left.effectId, right.effectId));
	unique(bindings.map((binding) => binding.effectId), 'photo effect mask bindings');
	return Object.freeze({
		processVersion: 1,
		effects,
		geometry: normalizeGeometry(field(input, 'geometry')),
		masks: Object.freeze(masks),
		maskBindings: Object.freeze(bindings),
	});
}

/** Clipboard and presets donate state only, never a photo or original identity. */
export function clonePhotoDevelopV1(value: unknown): PhotoDevelopV1 {
	return normalizePhotoDevelopV1(value);
}

export function defaultPhotoDevelopV1(): PhotoDevelopV1 {
	return normalizePhotoDevelopV1({
		processVersion: 1, effects: [], masks: [], maskBindings: [],
		geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
	});
}

function normalizeEffects(value: unknown): readonly VideoEffectLeaf[] {
	const inert = array(value, 'photo effects', 0, LIMITS.maximumEffects).map((candidate) => {
		const effect = record(candidate, 'photo effect', ['id', 'type', 'enabled', 'params']);
		const paramsValue = field(effect, 'params');
		// The shared registry owns parameter names, ranges and defaults. First ensure
		// its JS reader receives only inert own properties, never user accessors.
		if (!paramsValue || typeof paramsValue !== 'object') throw new TypeError('Photo effect params require a plain object.');
		const params = record(paramsValue, 'photo effect params', Object.keys(paramsValue));
		const detachedParams = Object.create(null) as Record<string, unknown>;
		for (const key of Object.keys(params)) detachedParams[key] = field(params, key);
		return {
			id: id(field(effect, 'id'), 'photo effect ID'),
			type: field(effect, 'type'),
			enabled: boolean(field(effect, 'enabled'), 'photo effect enabled'),
			params: detachedParams,
		};
	});
	const normalized = normalizeVideoEffects(inert, 'photo effects') as VideoEffectLeaf[];
	return Object.freeze(normalized.map((effect) => Object.freeze({
		id: effect.id, type: effect.type, enabled: effect.enabled, params: Object.freeze({ ...effect.params }),
	})));
}

function normalizeGeometry(value: unknown): PhotoGeometryV1 {
	const input = record(value, 'photo geometry', ['crop', 'rotationDegrees', 'flipHorizontal', 'flipVertical']);
	const candidate = field(input, 'crop');
	let crop: PhotoGeometryV1['crop'] = null;
	if (candidate !== null) {
		const inputCrop = record(candidate, 'photo crop', ['x', 'y', 'width', 'height']);
		const x = number(field(inputCrop, 'x'), 0, 1, 'photo crop x');
		const y = number(field(inputCrop, 'y'), 0, 1, 'photo crop y');
		const width = number(field(inputCrop, 'width'), Number.MIN_VALUE, 1, 'photo crop width');
		const height = number(field(inputCrop, 'height'), Number.MIN_VALUE, 1, 'photo crop height');
		if (x + width > 1 || y + height > 1) throw new RangeError('Photo crop must lie inside the original image.');
		crop = Object.freeze({ x, y, width, height });
	}
	return Object.freeze({
		crop,
		rotationDegrees: number(field(input, 'rotationDegrees'), -180, 180, 'photo rotation'),
		flipHorizontal: boolean(field(input, 'flipHorizontal'), 'photo horizontal flip'),
		flipVertical: boolean(field(input, 'flipVertical'), 'photo vertical flip'),
	});
}

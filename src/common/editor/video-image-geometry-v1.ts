/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { centeredImageGeometryAspectCropV1, normalizeImageGeometryV1, type ImageGeometryAspectPresetV1 } from './imaging/image-geometry-v1.ts';
import { containImageGeometryPlanV1, planImageGeometryV1 } from './imaging/image-geometry-plan-v1.ts';

export const IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 = 'develop-geometry-v1';
export const IMAGE_GEOMETRY_VIDEO_EFFECT_CODE_V1 = 20;
const ASPECTS: readonly ImageGeometryAspectPresetV1[] = ['free', 'source', '1:1', '4:3', '3:2', '16:9', '9:16'];
const ASPECT_LABEL_KEYS = ['videoEffectOptionFreeAspect', 'videoEffectOptionSourceAspect', 'videoEffectOptionAspectSquare',
	'videoEffectOptionAspectFourThree', 'videoEffectOptionAspectThreeTwo', 'videoEffectOptionAspectSixteenNine', 'videoEffectOptionAspectNineSixteen'];
function parameter(label: string, labelKey: string, initial: number, minimum = 0, maximum = 1, step = 0.001, integer = false) {
	return Object.freeze({ label, labelKey, default: initial, min: minimum, max: maximum, step, integer, control: 'number' });
}
function toggle(label: string, labelKey: string) {
	return Object.freeze({ ...parameter(label, labelKey, 0, 0, 1, 1, true), control: 'select',
		options: Object.freeze([{ value: 0, labelKey: 'videoEffectOptionOff', label: 'Off' }, { value: 1, labelKey: 'videoEffectOptionOn', label: 'On' }]) });
}
export const IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, label: 'Crop and perspective (contain)', labelKey: 'videoEffectImageGeometry',
	shader: IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, ffmpegFilter: IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1,
	params: Object.freeze({
		cropX: parameter('Crop left', 'videoEffectParamCropX', 0), cropY: parameter('Crop top', 'videoEffectParamCropY', 0),
		cropWidth: parameter('Crop width', 'videoEffectParamCropWidth', 1, 0.001), cropHeight: parameter('Crop height', 'videoEffectParamCropHeight', 1, 0.001),
		aspect: Object.freeze({ ...parameter('Crop aspect', 'videoEffectParamCropAspect', 0, 0, 6, 1, true), control: 'select',
			options: Object.freeze(ASPECTS.map((aspect, value) => Object.freeze({ value, label: aspect, labelKey: ASPECT_LABEL_KEYS[value]! }))) }),
		rotationDegrees: parameter('Clockwise rotation', 'videoEffectParamGeometryRotation', 0, -180, 180, 0.01),
		flipHorizontal: toggle('Flip horizontally', 'videoEffectParamFlipHorizontal'), flipVertical: toggle('Flip vertically', 'videoEffectParamFlipVertical'),
		perspective: toggle('Rectify source quad', 'videoEffectParamPerspective'),
		topLeftX: parameter('Top left X', 'videoEffectParamTopLeftX', 0), topLeftY: parameter('Top left Y', 'videoEffectParamTopLeftY', 0),
		topRightX: parameter('Top right X', 'videoEffectParamTopRightX', 1), topRightY: parameter('Top right Y', 'videoEffectParamTopRightY', 0),
		bottomRightX: parameter('Bottom right X', 'videoEffectParamBottomRightX', 1), bottomRightY: parameter('Bottom right Y', 'videoEffectParamBottomRightY', 1),
		bottomLeftX: parameter('Bottom left X', 'videoEffectParamBottomLeftX', 0), bottomLeftY: parameter('Bottom left Y', 'videoEffectParamBottomLeftY', 1),
	}),
});

/** The versioned effect is numeric for existing project/photo effect persistence; no V1 geometry fields widen. */
export function normalizeImageGeometryVideoParamsV1(value: unknown): Readonly<Record<string, number>> {
	const definitions = IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1.params;
	const input = record(value === undefined ? {} : value, 'image geometry parameters', Object.keys(definitions), []);
	const params: Record<string, number> = {};
	for (const [key, descriptor] of Object.entries(definitions)) {
		const candidate = Object.hasOwn(input, key) ? field(input, key, 'image geometry parameters') : descriptor.default;
		if (typeof candidate !== 'number' || !Number.isFinite(candidate) || Object.is(candidate, -0) || candidate < descriptor.min
			|| candidate > descriptor.max || (descriptor.integer && !Number.isSafeInteger(candidate))) throw new RangeError(`Invalid image geometry parameter ${key}.`);
		params[key] = candidate;
	}
	geometry(params, 1, 1); return Object.freeze(params);
}

export function normalizeImageGeometryVideoEffectV1(value: unknown) {
	const input = record(value, 'image geometry effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'image geometry effect'), enabled = field(input, 'enabled', 'image geometry effect');
	if (typeof id !== 'string' || id.length < 1 || id.length > 128) throw new TypeError('Image geometry requires a bounded ID.');
	if (field(input, 'type', 'image geometry effect') !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) throw new RangeError('Unsupported image geometry effect.');
	if (typeof enabled !== 'boolean') throw new TypeError('Image geometry enabled must be boolean.');
	const params = field(input, 'params', 'image geometry effect');
	if (params === undefined) throw new TypeError('Image geometry parameters are required.');
	return Object.freeze({ id, type: IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, enabled, params: normalizeImageGeometryVideoParamsV1(params) });
}

export function imageGeometryForVideoEffectV1(value: unknown, width: number, height: number) {
	return geometry(normalizeImageGeometryVideoEffectV1(value).params, width, height);
}
export function imageGeometryVideoPreviewPassV1(value: unknown) {
	const effect = normalizeImageGeometryVideoEffectV1(value);
	return effect.enabled ? Object.freeze({ code: IMAGE_GEOMETRY_VIDEO_EFFECT_CODE_V1, geometry: effect,
		params0: Object.freeze([0, 0, 0, 0]), params1: Object.freeze([0, 0, 0, 0]), direction: Object.freeze([0, 0]) }) : null;
}
export function imageGeometryVideoPlanV1(value: unknown, width: number, height: number) {
	return containImageGeometryPlanV1(planImageGeometryV1(imageGeometryForVideoEffectV1(value, width, height), width, height), width, height);
}

function geometry(params: Readonly<Record<string, number>>, width: number, height: number) {
	const crop = centeredImageGeometryAspectCropV1(width, height, ASPECTS[params.aspect!]!,
		{ x: params.cropX!, y: params.cropY!, width: params.cropWidth!, height: params.cropHeight! });
	return normalizeImageGeometryV1({ schemaVersion: 1, crop, rotationDegrees: params.rotationDegrees,
		flipHorizontal: params.flipHorizontal === 1, flipVertical: params.flipVertical === 1,
		perspective: params.perspective === 1 ? { topLeft: { x: params.topLeftX, y: params.topLeftY },
			 topRight: { x: params.topRightX, y: params.topRightY }, bottomRight: { x: params.bottomRightX, y: params.bottomRightY },
			 bottomLeft: { x: params.bottomLeftX, y: params.bottomLeftY } } : null });
}

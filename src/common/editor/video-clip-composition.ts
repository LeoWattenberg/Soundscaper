/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';

export const VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION = 1 as const;

export const VIDEO_CLIP_COMPOSITION_BLEND_MODES = Object.freeze([
	'normal',
	'multiply',
	'screen',
	'overlay',
	'darken',
	'lighten',
	'difference',
	'exclusion',
] as const);

export const VIDEO_CLIP_COMPOSITION_PARAMETER_IDS = Object.freeze([
	'crop.left',
	'crop.top',
	'crop.right',
	'crop.bottom',
	'transform.anchorX',
	'transform.anchorY',
	'transform.positionX',
	'transform.positionY',
	'transform.scaleX',
	'transform.scaleY',
	'transform.rotationDegrees',
	'opacity',
	'transform.flipHorizontal',
	'transform.flipVertical',
	'blendMode',
	'compositingOrder',
] as const);

export type VideoClipCompositionBlendMode = typeof VIDEO_CLIP_COMPOSITION_BLEND_MODES[number];
export type VideoClipCompositionParameterId = typeof VIDEO_CLIP_COMPOSITION_PARAMETER_IDS[number];

export interface VideoClipCompositionCrop {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface VideoClipCompositionTransform {
	readonly anchorX: number;
	readonly anchorY: number;
	readonly positionX: number;
	readonly positionY: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly rotationDegrees: number;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
}

export interface VideoClipComposition {
	readonly schemaVersion: typeof VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION;
	readonly crop: VideoClipCompositionCrop;
	readonly transform: VideoClipCompositionTransform;
	readonly opacity: number;
	readonly blendMode: VideoClipCompositionBlendMode;
	readonly compositingOrder: number;
}

const COMPOSITION_FIELDS = Object.freeze([
	'schemaVersion', 'crop', 'transform', 'opacity', 'blendMode', 'compositingOrder',
]);
const CROP_FIELDS = Object.freeze(['left', 'top', 'right', 'bottom']);
const TRANSFORM_FIELDS = Object.freeze([
	'anchorX', 'anchorY', 'positionX', 'positionY', 'scaleX', 'scaleY',
	'rotationDegrees', 'flipHorizontal', 'flipVertical',
]);
const BLEND_MODE_SET: ReadonlySet<string> = new Set(VIDEO_CLIP_COMPOSITION_BLEND_MODES);

const MINIMUM_POSITION = -8;
const MAXIMUM_POSITION = 8;
const MINIMUM_SCALE = 0.01;
const MAXIMUM_SCALE = 100;
const MINIMUM_ROTATION_DEGREES = -36_000;
const MAXIMUM_ROTATION_DEGREES = 36_000;
const MINIMUM_COMPOSITING_ORDER = -32_768;
const MAXIMUM_COMPOSITING_ORDER = 32_767;

/** Validate a persisted composition into its detached, recursively frozen canonical form. */
export function normalizeVideoClipComposition(
	value: unknown,
	name = 'video clip composition',
): VideoClipComposition {
	const composition = readClosedDomainRecord(value, name, COMPOSITION_FIELDS);
	const schemaVersion = field(composition, 'schemaVersion', name);
	if (schemaVersion !== VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION) {
		throw new RangeError(`${name}.schemaVersion must be 1.`);
	}
	const crop = normalizeCrop(field(composition, 'crop', name), `${name}.crop`);
	const transform = normalizeTransform(
		field(composition, 'transform', name),
		`${name}.transform`,
	);
	const blendMode = field(composition, 'blendMode', name);
	if (typeof blendMode !== 'string' || !BLEND_MODE_SET.has(blendMode)) {
		throw new RangeError(`${name}.blendMode is unsupported.`);
	}
	return Object.freeze({
		schemaVersion: VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION,
		crop,
		transform,
		opacity: boundedNumber(field(composition, 'opacity', name), `${name}.opacity`, 0, 1),
		blendMode: blendMode as VideoClipCompositionBlendMode,
		compositingOrder: boundedSafeInteger(
			field(composition, 'compositingOrder', name),
			`${name}.compositingOrder`,
			MINIMUM_COMPOSITING_ORDER,
			MAXIMUM_COMPOSITING_ORDER,
		),
	});
}

/** Clone a composition across an ownership boundary while revalidating its exact wire value. */
export function cloneVideoClipComposition(
	value: unknown,
	name = 'video clip composition',
): VideoClipComposition {
	return normalizeVideoClipComposition(value, name);
}

export function isDefaultVideoClipComposition(value: unknown): boolean {
	return canonicalCompositionsEqual(
		normalizeVideoClipComposition(value),
		DEFAULT_VIDEO_CLIP_COMPOSITION,
	);
}

export function videoClipCompositionsEqual(left: unknown, right: unknown): boolean {
	return canonicalCompositionsEqual(
		normalizeVideoClipComposition(left, 'left video clip composition'),
		normalizeVideoClipComposition(right, 'right video clip composition'),
	);
}

function normalizeCrop(value: unknown, name: string): VideoClipCompositionCrop {
	const crop = readClosedDomainRecord(value, name, CROP_FIELDS);
	const left = boundedNumber(field(crop, 'left', name), `${name}.left`, 0, 1);
	const top = boundedNumber(field(crop, 'top', name), `${name}.top`, 0, 1);
	const right = boundedNumber(field(crop, 'right', name), `${name}.right`, 0, 1);
	const bottom = boundedNumber(field(crop, 'bottom', name), `${name}.bottom`, 0, 1);
	if (left + right >= 1) throw new RangeError(`${name}.left plus ${name}.right must be less than 1.`);
	if (top + bottom >= 1) throw new RangeError(`${name}.top plus ${name}.bottom must be less than 1.`);
	return Object.freeze({ left, top, right, bottom });
}

function normalizeTransform(value: unknown, name: string): VideoClipCompositionTransform {
	const transform = readClosedDomainRecord(value, name, TRANSFORM_FIELDS);
	return Object.freeze({
		anchorX: boundedNumber(field(transform, 'anchorX', name), `${name}.anchorX`, 0, 1),
		anchorY: boundedNumber(field(transform, 'anchorY', name), `${name}.anchorY`, 0, 1),
		positionX: boundedNumber(
			field(transform, 'positionX', name), `${name}.positionX`, MINIMUM_POSITION, MAXIMUM_POSITION,
		),
		positionY: boundedNumber(
			field(transform, 'positionY', name), `${name}.positionY`, MINIMUM_POSITION, MAXIMUM_POSITION,
		),
		scaleX: boundedNumber(
			field(transform, 'scaleX', name), `${name}.scaleX`, MINIMUM_SCALE, MAXIMUM_SCALE,
		),
		scaleY: boundedNumber(
			field(transform, 'scaleY', name), `${name}.scaleY`, MINIMUM_SCALE, MAXIMUM_SCALE,
		),
		rotationDegrees: boundedNumber(
			field(transform, 'rotationDegrees', name),
			`${name}.rotationDegrees`,
			MINIMUM_ROTATION_DEGREES,
			MAXIMUM_ROTATION_DEGREES,
		),
		flipHorizontal: booleanValue(
			field(transform, 'flipHorizontal', name), `${name}.flipHorizontal`,
		),
		flipVertical: booleanValue(
			field(transform, 'flipVertical', name), `${name}.flipVertical`,
		),
	});
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function boundedNumber(value: unknown, name: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number.`);
	}
	if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
	if (value < minimum || value > maximum) throw new RangeError(`${name} is outside its range.`);
	return value;
}

function boundedSafeInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number.`);
	}
	if (Object.is(value, -0)) throw new RangeError(`${name} must not be negative zero.`);
	if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer.`);
	if (value < minimum || value > maximum) throw new RangeError(`${name} is outside its range.`);
	return value;
}

function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`);
	return value;
}

function canonicalCompositionsEqual(left: VideoClipComposition, right: VideoClipComposition): boolean {
	return left.schemaVersion === right.schemaVersion
		&& left.crop.left === right.crop.left
		&& left.crop.top === right.crop.top
		&& left.crop.right === right.crop.right
		&& left.crop.bottom === right.crop.bottom
		&& left.transform.anchorX === right.transform.anchorX
		&& left.transform.anchorY === right.transform.anchorY
		&& left.transform.positionX === right.transform.positionX
		&& left.transform.positionY === right.transform.positionY
		&& left.transform.scaleX === right.transform.scaleX
		&& left.transform.scaleY === right.transform.scaleY
		&& left.transform.rotationDegrees === right.transform.rotationDegrees
		&& left.transform.flipHorizontal === right.transform.flipHorizontal
		&& left.transform.flipVertical === right.transform.flipVertical
		&& left.opacity === right.opacity
		&& left.blendMode === right.blendMode
		&& left.compositingOrder === right.compositingOrder;
}

export const DEFAULT_VIDEO_CLIP_COMPOSITION: VideoClipComposition = normalizeVideoClipComposition({
	schemaVersion: VIDEO_CLIP_COMPOSITION_SCHEMA_VERSION,
	crop: { left: 0, top: 0, right: 0, bottom: 0 },
	transform: {
		anchorX: 0.5,
		anchorY: 0.5,
		positionX: 0.5,
		positionY: 0.5,
		scaleX: 1,
		scaleY: 1,
		rotationDegrees: 0,
		flipHorizontal: false,
		flipVertical: false,
	},
	opacity: 1,
	blendMode: 'normal',
	compositingOrder: 0,
});

/** Alternate constant spelling retained for composition-domain consumers. */
export const VIDEO_CLIP_COMPOSITION_DEFAULT = DEFAULT_VIDEO_CLIP_COMPOSITION;

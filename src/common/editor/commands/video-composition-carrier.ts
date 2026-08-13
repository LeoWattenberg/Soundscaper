/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	cloneVideoClipComposition,
	videoClipCompositionsEqual,
	type VideoClipComposition,
} from '../video-clip-composition.ts';

type DataRecord = Record<string, unknown>;

const NO_COMPOSITION = Object.freeze({});

/** Snapshot an optional video-composition carrier without invoking accessors. */
export function cloneVideoCompositionCarrierFields(
	value: unknown,
	name = 'video clip',
): Readonly<{ readonly videoComposition?: VideoClipComposition }> {
	const composition = optionalComposition(value, name);
	return composition === undefined
		? NO_COMPOSITION
		: Object.freeze({
			videoComposition: cloneVideoClipComposition(composition, `${name}.videoComposition`),
		});
}

/** Replace a spread-carried nested value with one independently owned canonical snapshot. */
export function detachVideoCompositionCarrier<Result extends DataRecord>(
	result: Result,
	source: unknown,
	name = 'video clip',
): Result {
	const fields = cloneVideoCompositionCarrierFields(source, name);
	return Object.hasOwn(fields, 'videoComposition')
		? { ...result, ...fields }
		: result;
}

/** Legacy clips without the field compare equal; mixed or unequal carriers do not. */
export function videoCompositionCarriersEqual(left: unknown, right: unknown): boolean {
	const leftComposition = optionalComposition(left, 'left video clip');
	const rightComposition = optionalComposition(right, 'right video clip');
	if (leftComposition === undefined || rightComposition === undefined) {
		return leftComposition === undefined && rightComposition === undefined;
	}
	return videoClipCompositionsEqual(leftComposition, rightComposition);
}

function optionalComposition(value: unknown, name: string): unknown | undefined {
	if (!isRecord(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'videoComposition');
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.videoComposition must be an own enumerable data property.`);
	}
	const kind = Object.getOwnPropertyDescriptor(value, 'kind');
	if (!kind?.enumerable || !Object.hasOwn(kind, 'value') || kind.value !== 'video') {
		throw new TypeError(`${name} must be a video clip to carry videoComposition.`);
	}
	return descriptor.value;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

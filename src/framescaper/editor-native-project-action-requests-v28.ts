/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed menu intent for selected-V28 pathless import and native delivery. */

import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM,
	type NativeMediaImageSequenceRateV1,
} from '../common/editor/native-media-image-sequence.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from '../common/editor/native-media-v14-native-dispatch.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';

export interface FramescaperNativeImageSequenceImportRequestV28 {
	readonly frameRate: NativeMediaImageSequenceRateV1;
}

export const FRAMESCAPER_V28_IMAGE_SEQUENCE_EXPORT_FORMATS = Object.freeze([
	'png', 'tiff', 'openexr',
] as const);

export type FramescaperV28ImageSequenceExportFormat =
	(typeof FRAMESCAPER_V28_IMAGE_SEQUENCE_EXPORT_FORMATS)[number];

export type FramescaperV28ImageSequenceEncodeProfile =
	| 'encode-png-sequence' | 'encode-tiff-sequence' | 'encode-openexr-sequence';

export type FramescaperNativeRenderDeliveryRequestV28 =
	| Readonly<{ readonly kind: 'encoded-mov' }>
	| Readonly<{
		readonly kind: 'image-sequence';
		readonly format: FramescaperV28ImageSequenceExportFormat;
		readonly frameRate: NativeMediaImageSequenceRateV1;
		readonly preserveAlpha: true;
	}>;

export interface FramescaperV28ImageSequenceDeliveryDescriptor {
	readonly format: FramescaperV28ImageSequenceExportFormat;
	readonly profile: FramescaperV28ImageSequenceEncodeProfile;
	readonly extension: 'png' | 'tiff' | 'exr';
	readonly mimeType: 'image/png' | 'image/tiff' | 'image/x-exr';
}

const IMAGE_SEQUENCE_DESCRIPTORS: Readonly<Record<
	FramescaperV28ImageSequenceExportFormat,
	FramescaperV28ImageSequenceDeliveryDescriptor
>> = Object.freeze({
	png: descriptor('png', 'encode-png-sequence', 'png', 'image/png'),
	tiff: descriptor('tiff', 'encode-tiff-sequence', 'tiff', 'image/tiff'),
	openexr: descriptor('openexr', 'encode-openexr-sequence', 'exr', 'image/x-exr'),
});

export function snapshotFramescaperNativeImageSequenceImportRequestV28(
	value: unknown,
): FramescaperNativeImageSequenceImportRequestV28 {
	const request = exactRecord(value, ['frameRate'], 'user-selected V28 image-sequence import request');
	return Object.freeze({
		frameRate: exactRate(request.frameRate, 'user-selected image-sequence frame rate'),
	});
}

/** Undefined is the historical encoded MOV action and remains its exact default. */
export function snapshotFramescaperNativeRenderDeliveryRequestV28(
	value: unknown,
): FramescaperNativeRenderDeliveryRequestV28 {
	if (value === undefined) return Object.freeze({ kind: 'encoded-mov' as const });
	const candidate = exactRecord(value, undefined, 'selected V28 native delivery request');
	const kind = ownData(candidate, 'kind', 'selected V28 native delivery request');
	if (kind === 'encoded-mov') {
		exactFields(candidate, ['kind'], 'selected V28 MOV delivery request');
		return Object.freeze({ kind: 'encoded-mov' as const });
	}
	if (kind !== 'image-sequence') {
		throw new RangeError('The selected V28 native delivery format is unsupported.');
	}
	exactFields(
		candidate, ['kind', 'format', 'frameRate', 'preserveAlpha'],
		'selected V28 image-sequence delivery request',
	);
	const format = imageSequenceFormat(candidate.format);
	if (candidate.preserveAlpha !== true) {
		throw new RangeError('Selected V28 image-sequence delivery must preserve alpha.');
	}
	const frameRate = exactRate(candidate.frameRate, 'image-sequence delivery frame rate');
	const descriptor = framescaperV28ImageSequenceDeliveryDescriptor(format);
	const dispatch = nativeMediaV14EncodeDispatch(descriptor.profile);
	if (!dispatch.imageSequence || !dispatch.supportsAlpha || dispatch.audioEncoder !== null
		|| dispatch.atomicPublication !== 'exclusive-frame-directory-rename') {
		throw new Error('The selected V28 image-sequence profile lost its alpha output-tree authority.');
	}
	return Object.freeze({ kind: 'image-sequence' as const, format, frameRate, preserveAlpha: true });
}

function ownData(
	record: Readonly<Record<string, unknown>>,
	field: string,
	name: string,
): unknown {
	const property = Object.getOwnPropertyDescriptor(record, field);
	if (!property?.enumerable || !Object.hasOwn(property, 'value')) {
		throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
	}
	return property.value;
}

export function framescaperV28NativeDeliveryProfile(
	delivery: FramescaperNativeRenderDeliveryRequestV28,
): NativeMediaV14EncodeProfileId {
	return delivery.kind === 'encoded-mov'
		? 'encode-mov-prores-422-hq'
		: framescaperV28ImageSequenceDeliveryDescriptor(delivery.format).profile;
}

export function framescaperV28ImageSequenceDeliveryDescriptor(
	format: FramescaperV28ImageSequenceExportFormat,
): FramescaperV28ImageSequenceDeliveryDescriptor {
	const row = IMAGE_SEQUENCE_DESCRIPTORS[format];
	if (!row) throw new RangeError('The selected V28 image-sequence output format is unsupported.');
	return row;
}

/** Reconstruct only a selected menu delivery from an already normalized V14 plan. */
export function framescaperNativeRenderDeliveryRequestFromPlanV28(
	plan: UnifiedExactRenderPlanV14,
): FramescaperNativeRenderDeliveryRequestV28 {
	if (plan.deliveryProfile === 'encode-mov-prores-422-hq') {
		return Object.freeze({ kind: 'encoded-mov' as const });
	}
	const descriptor = Object.values(IMAGE_SEQUENCE_DESCRIPTORS)
		.find(({ profile }) => profile === plan.deliveryProfile);
	if (!descriptor) throw new RangeError('The V14 plan is not a selected V28 native delivery.');
	return snapshotFramescaperNativeRenderDeliveryRequestV28({
		kind: 'image-sequence', format: descriptor.format,
		frameRate: plan.output.frameRate, preserveAlpha: true,
	});
}

function descriptor(
	format: FramescaperV28ImageSequenceExportFormat,
	profile: FramescaperV28ImageSequenceEncodeProfile,
	extension: FramescaperV28ImageSequenceDeliveryDescriptor['extension'],
	mimeType: FramescaperV28ImageSequenceDeliveryDescriptor['mimeType'],
): FramescaperV28ImageSequenceDeliveryDescriptor {
	return Object.freeze({ format, profile, extension, mimeType });
}

function imageSequenceFormat(value: unknown): FramescaperV28ImageSequenceExportFormat {
	if (typeof value !== 'string'
		|| !(FRAMESCAPER_V28_IMAGE_SEQUENCE_EXPORT_FORMATS as readonly string[]).includes(value)) {
		throw new RangeError('The selected V28 image-sequence output format is unsupported.');
	}
	return value as FramescaperV28ImageSequenceExportFormat;
}

function exactRate(
	value: unknown,
	name: string,
): NativeMediaImageSequenceRateV1 {
	const rate = exactRecord(value, ['num', 'den'], name);
	if (!Number.isSafeInteger(rate.num) || Number(rate.num) < 1
		|| Number(rate.num) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
		|| !Number.isSafeInteger(rate.den) || Number(rate.den) < 1
		|| Number(rate.den) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
		|| gcd(Number(rate.num), Number(rate.den)) !== 1) {
		throw new TypeError(`${name} must be an exact reduced rational.`);
	}
	return Object.freeze({ num: Number(rate.num), den: Number(rate.den) });
}

function gcd(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function exactRecord(
	value: unknown,
	fields: readonly string[] | undefined,
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain data record.`);
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (fields) exactFields(record, fields, name);
	return record;
}

function exactFields(
	record: Readonly<Record<string, unknown>>,
	fields: readonly string[],
	name: string,
): void {
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string'
		|| !fields.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	for (const field of fields) {
		const property = Object.getOwnPropertyDescriptor(record, field);
		if (!property?.enumerable || !Object.hasOwn(property, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
	}
}

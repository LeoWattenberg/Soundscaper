/* SPDX-License-Identifier: AGPL-3.0-only */

import { HelperContractViolationError } from './helper-wire-admission.ts';

export const HELPER_NATIVE_INPUT_ROLES = Object.freeze([
	'original', 'evaluated-rgba-frame-pack', 'staged-audio-mix',
	'image-sequence-pack', 'image-sequence-inventory',
] as const);
export type HelperNativeInputRole = (typeof HELPER_NATIVE_INPUT_ROLES)[number];

export interface HelperMediaImageSequenceDecodeGrant {
	readonly kind: 'native-image-sequence-decode-v1';
	readonly profileId: 'decode-png-sequence' | 'decode-tiff-sequence' | 'decode-openexr-sequence';
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
}

const IMAGE_SEQUENCE_KEYS = Object.freeze(['kind', 'profileId', 'frameRate']);
const RATE_KEYS = Object.freeze(['num', 'den']);

export function validateHelperNativeInputRole(value: unknown): HelperNativeInputRole {
	if (typeof value !== 'string'
		|| !(HELPER_NATIVE_INPUT_ROLES as readonly string[]).includes(value)) {
		return unsafe('A helper native input must carry one exact role.');
	}
	return value as HelperNativeInputRole;
}

export function validateHelperMediaImageSequenceDecodeGrant(
	value: unknown,
): HelperMediaImageSequenceDecodeGrant {
	const record = exactRecord(value, IMAGE_SEQUENCE_KEYS);
	const rate = exactRecord(record.frameRate, RATE_KEYS);
	const profiles = ['decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence'] as const;
	if (record.kind !== 'native-image-sequence-decode-v1'
		|| typeof record.profileId !== 'string'
		|| !(profiles as readonly string[]).includes(record.profileId)
		|| !Number.isSafeInteger(rate.num) || Number(rate.num) < 1 || Number(rate.num) > 1_000_000
		|| !Number.isSafeInteger(rate.den) || Number(rate.den) < 1 || Number(rate.den) > 1_000_000) {
		return unsafe('An image-sequence decode grant has an unsupported profile or rational rate.');
	}
	if (greatestCommonDivisor(Number(rate.num), Number(rate.den)) !== 1) {
		return unsafe('An image-sequence decode grant requires a reduced rational rate.');
	}
	return Object.freeze({
		kind: 'native-image-sequence-decode-v1',
		profileId: record.profileId as HelperMediaImageSequenceDecodeGrant['profileId'],
		frameRate: Object.freeze({ num: Number(rate.num), den: Number(rate.den) }),
	});
}

function greatestCommonDivisor(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		return unsafe('An image-sequence helper grant must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		return unsafe('An image-sequence helper grant must carry its exact schema keys.');
	}
	return record;
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}

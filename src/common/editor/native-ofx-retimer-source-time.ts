/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoRetimeExactOrdinalAuthority,
	resolveVideoRetimeExactPictureOrdinal,
	type VideoRetimeExactOrdinalAuthority,
} from './video-retime-exact-ordinal-authority.ts';

export interface OfxRetimerSourceTimeV1 {
	readonly parameter: 'SourceTime';
	readonly outputOrdinal: number;
	readonly clipId: string;
	readonly sourceId: string;
	readonly numerator: string;
	readonly denominator: string;
}

const AUTHENTIC_SOURCE_TIMES = new WeakSet<OfxRetimerSourceTimeV1>();

/**
 * The sole candidate binding from Framescaper timing to OFX Retimer
 * `SourceTime`. The plug-in host receives the exact oracle value and never
 * derives it from a Number clock, source ordinal, or independent schedule.
 */
export function createOfxRetimerSourceTimeV1(
	authority: VideoRetimeExactOrdinalAuthority,
	requestValue: unknown,
): OfxRetimerSourceTimeV1 {
	const request = closedRequest(requestValue);
	assertVideoRetimeExactOrdinalAuthority(authority);
	let picture;
	try {
		picture = resolveVideoRetimeExactPictureOrdinal(authority, request);
	} catch (cause) {
		throw new ReferenceError('OFX Retimer SourceTime requires one exact oracle picture binding.', { cause });
	}
	const sourceTime = picture.sourceTime;
	const result = Object.freeze({
		parameter: 'SourceTime',
		outputOrdinal: request.outputOrdinal,
		clipId: request.clipId,
		sourceId: request.sourceId,
		numerator: sourceTime.numerator.toString(),
		denominator: sourceTime.denominator.toString(),
	});
	AUTHENTIC_SOURCE_TIMES.add(result);
	return result;
}

/** Refuse a structurally forged SourceTime that did not come from the exact oracle. */
export function assertAuthenticatedOfxRetimerSourceTimeV1(
	value: unknown,
): asserts value is OfxRetimerSourceTimeV1 {
	if (!value || typeof value !== 'object'
		|| !AUTHENTIC_SOURCE_TIMES.has(value as OfxRetimerSourceTimeV1)) {
		throw new TypeError('OFX Retimer SourceTime must come from the exact ordinal oracle.');
	}
}

function closedRequest(value: unknown): Readonly<{
	readonly outputOrdinal: number; readonly clipId: string; readonly sourceId: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('OFX Retimer SourceTime request must be a closed data record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	const expected = ['outputOrdinal', 'clipId', 'sourceId'];
	if (keys.length !== expected.length || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
		throw new TypeError('OFX Retimer SourceTime request has an invalid closed shape.');
	}
	const read = (key: string): unknown => {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`OFX Retimer SourceTime request.${key} must be an enumerable data field.`);
		}
		return descriptor.value;
	};
	const outputOrdinal = read('outputOrdinal');
	const clipId = read('clipId');
	const sourceId = read('sourceId');
	if (!Number.isSafeInteger(outputOrdinal) || Number(outputOrdinal) < 0) {
		throw new RangeError('OFX Retimer SourceTime outputOrdinal must be a non-negative safe integer.');
	}
	if (typeof clipId !== 'string' || clipId.length < 1 || typeof sourceId !== 'string' || sourceId.length < 1) {
		throw new TypeError('OFX Retimer SourceTime requires clip and source identities.');
	}
	return Object.freeze({ outputOrdinal: Number(outputOrdinal), clipId, sourceId });
}

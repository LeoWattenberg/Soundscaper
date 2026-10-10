/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeWebCodecsEncode } from './video-keyframe-webcodecs-execution.ts';

const NAME = 'video keyframe WebCodecs decision';
const FIELDS = new Set(['codec', 'bitrate', 'encoderClass', 'videoFrameClass', 'hardwareAcceleration']);

/** Capture the exact encoder decision before any native or streamed execution. */
export function validateVideoKeyframeWebCodecsDecision(value: unknown): VideoKeyframeWebCodecsEncode {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${NAME} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${NAME} must be a plain object.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !FIELDS.has(key)) {
			throw new TypeError(`${NAME} has an unsupported field.`);
		}
		data(value, key);
	}
	const codec = data(value, 'codec');
	if (typeof codec !== 'string' || codec.length === 0 || codec.length > 128) {
		throw new TypeError(`${NAME}.codec must be a codec string.`);
	}
	const bitrate = data(value, 'bitrate');
	if (typeof bitrate !== 'number' || !Number.isSafeInteger(bitrate) || bitrate <= 0) {
		throw new RangeError(`${NAME}.bitrate must be a positive integer.`);
	}
	const encoderClass = data(value, 'encoderClass');
	const videoFrameClass = data(value, 'videoFrameClass');
	for (const [key, constructor] of [['encoderClass', encoderClass], ['videoFrameClass', videoFrameClass]]) {
		if (typeof constructor !== 'function') throw new TypeError(`${NAME}.${String(key)} must be a constructor.`);
	}
	const hasHardwarePreference = Object.hasOwn(value, 'hardwareAcceleration');
	if (hasHardwarePreference && data(value, 'hardwareAcceleration') !== 'prefer-hardware') {
		throw new TypeError(`${NAME}.hardwareAcceleration must be prefer-hardware.`);
	}
	return Object.freeze({
		codec, bitrate, encoderClass, videoFrameClass,
		...(hasHardwarePreference ? { hardwareAcceleration: 'prefer-hardware' as const } : {}),
	});
}

function data(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${NAME}.${key} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

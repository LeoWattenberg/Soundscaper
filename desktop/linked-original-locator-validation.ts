/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute } from 'node:path';

export type LinkedOriginalMediaKind = 'audio' | 'video';

export function linkedOriginalMediaKind(
	value: unknown,
	fallback?: LinkedOriginalMediaKind,
): LinkedOriginalMediaKind {
	if (value === undefined && fallback) return fallback;
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('A linked-original media kind must be audio or video.');
	}
	return value;
}

export function linkedOriginalMimeType(
	kind: LinkedOriginalMediaKind,
	value: unknown,
	name: string,
	label = 'A linked-original locator',
): string {
	if (typeof value !== 'string' || value.length > 128) {
		throw new TypeError(`${label} has an invalid MIME type.`);
	}
	if (kind === 'video') {
		if (!/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value)) {
			throw new TypeError(`${label} requires a canonical video MIME type.`);
		}
		return value;
	}
	const lowerName = name.toLowerCase();
	if ((/\.aiff?$/u.test(lowerName) && value === 'audio/aiff')
		|| (lowerName.endsWith('.wav') && value === 'audio/wav')
		|| (lowerName.endsWith('.rf64') && value === 'audio/rf64')) return value;
	throw new TypeError(`${label} requires canonical AIFF, WAV, or RF64 audio metadata.`);
}

export function boundedLimit(value: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${label} must be a positive integer no greater than ${maximum}.`);
	}
	return value;
}

export function requiredLocatorOwner(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('A linked-video locator owner is required.');
	}
	return value as object;
}

export function absoluteLinkedOriginalPath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('A linked-video locator requires an absolute file path.');
	}
	return value;
}

export function linkedOriginalDisplayName(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| value.length > 255 || value === '.' || value === '..'
		|| value.includes('/') || value.includes('\\') || /[\u0000-\u001f]/u.test(value)) {
		throw new TypeError('A linked-video locator display name is invalid.');
	}
	return value;
}

export function linkedOriginalOpaqueToken(value: unknown, message: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(message);
	return value;
}

export function nullableLocatorRevision(value: unknown): string | null {
	return value === null
		? null
		: linkedOriginalOpaqueToken(value, 'Invalid linked-video locator revision.');
}

export function linkedOriginalReadTimestamp(value: number): number {
	const timestamp = Math.max(0, Math.trunc(value));
	if (!Number.isSafeInteger(timestamp)) throw new RangeError('Linked-video modification time is invalid.');
	return timestamp;
}

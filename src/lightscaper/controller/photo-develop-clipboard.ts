/* SPDX-License-Identifier: AGPL-3.0-only */

import { clonePhotoDevelopV1 } from '../catalog/develop-state.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDevelopV1 } from '../catalog/types.ts';
import { field, oneOf, record, requireSchema } from '../catalog/value-validation.ts';

export interface PhotoDevelopClipboardV1 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
	readonly kind: 'photo-develop-clipboard';
	readonly develop: PhotoDevelopV1;
}

/** Settings donate no photo identity, originals, or authority over external mask media. */
export function createPhotoDevelopClipboardV1(value: unknown): PhotoDevelopClipboardV1 {
	const develop = clonePhotoDevelopV1(value);
	if (develop.masks.some((mask) => mask.inputs.length > 0)) throw new RangeError('External mask media requires an authenticated clipboard adapter.');
	const packet = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion: 1 as const,
		kind: 'photo-develop-clipboard' as const, develop });
	assertBytes(JSON.stringify(packet));
	return packet;
}

export function normalizePhotoDevelopClipboardV1(value: unknown): PhotoDevelopClipboardV1 {
	const input = record(value, 'photo develop clipboard', ['schemaFamily', 'schemaVersion', 'kind', 'develop']);
	requireSchema(input);
	oneOf(field(input, 'kind'), ['photo-develop-clipboard'] as const, 'photo clipboard kind');
	return createPhotoDevelopClipboardV1(field(input, 'develop'));
}

/** Shared normalization builds inert records in a deterministic field order. */
export function serializePhotoDevelopClipboardV1(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopClipboardV1(value));
}

export function parsePhotoDevelopClipboardV1(value: string): PhotoDevelopClipboardV1 {
	if (typeof value !== 'string') throw new TypeError('Photo develop clipboard requires JSON text.');
	assertBytes(value);
	const decoded: unknown = JSON.parse(value);
	return normalizePhotoDevelopClipboardV1(decoded);
}

function assertBytes(value: string): void {
	if (value.length > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes
		|| new TextEncoder().encode(value).byteLength > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) {
		throw new RangeError('Photo develop clipboard exceeds its byte budget.');
	}
}

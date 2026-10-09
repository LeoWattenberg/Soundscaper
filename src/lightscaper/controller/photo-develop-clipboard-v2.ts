/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizePhotoDevelopClipboardV1, type PhotoDevelopClipboardV1 } from './photo-develop-clipboard.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDevelopV1 } from '../catalog/types.ts';
import { field, oneOf, record } from '../catalog/value-validation.ts';

export interface PhotoDevelopClipboardV2 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 2;
	readonly kind: 'photo-develop-clipboard';
	readonly develop: PhotoDevelopV1 | ImageDevelopStateV2;
}

/** Settings donate no photo identity, originals, or authority over external mask media. */
export function createPhotoDevelopClipboardV2(value: unknown): PhotoDevelopClipboardV2 {
	const develop = normalizeImageDevelopStateV1OrV2(value);
	if (develop.masks.some((mask) => mask.inputs.length > 0)) throw new RangeError('External mask media requires an authenticated clipboard adapter.');
	const packet = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion: 2 as const,
		kind: 'photo-develop-clipboard' as const, develop });
	assertBytes(JSON.stringify(packet));
	return packet;
}

export function normalizePhotoDevelopClipboardV2(value: unknown): PhotoDevelopClipboardV2 {
	const input = record(value, 'photo develop clipboard', ['schemaFamily', 'schemaVersion', 'kind', 'develop']);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported photo clipboard version.');
	oneOf(field(input, 'kind'), ['photo-develop-clipboard'] as const, 'photo clipboard kind');
	return createPhotoDevelopClipboardV2(field(input, 'develop'));
}

/** Shared normalization builds inert records in a deterministic field order. */
export function serializePhotoDevelopClipboardV2(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopClipboardV2(value));
}

export function parsePhotoDevelopClipboardV2(value: string): PhotoDevelopClipboardV2 {
	if (typeof value !== 'string') throw new TypeError('Photo develop clipboard requires JSON text.');
	assertBytes(value);
	const decoded: unknown = JSON.parse(value);
	return normalizePhotoDevelopClipboardV2(decoded);
}

function assertBytes(value: string): void {
	if (value.length > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes
		|| new TextEncoder().encode(value).byteLength > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) {
		throw new RangeError('Photo develop clipboard exceeds its byte budget.');
	}
}

export function normalizePhotoDevelopClipboardV1OrV2(value: unknown): PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2 {
	const input = record(value, 'photo develop clipboard', ['schemaFamily', 'schemaVersion', 'kind', 'develop']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizePhotoDevelopClipboardV1(input);
	if (version === 2) return normalizePhotoDevelopClipboardV2(input);
	throw new RangeError('Unsupported photo clipboard version.');
}

export function serializePhotoDevelopClipboardV1OrV2(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopClipboardV1OrV2(value));
}

export function parsePhotoDevelopClipboardV1OrV2(value: string): PhotoDevelopClipboardV1 | PhotoDevelopClipboardV2 {
	if (typeof value !== 'string') throw new TypeError('Photo develop clipboard requires JSON text.');
	assertBytes(value); const decoded: unknown = JSON.parse(value);
	return normalizePhotoDevelopClipboardV1OrV2(decoded);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseId3Artwork } from './id3-artwork.ts';

const MAX_METADATA_FIELDS = 128;
const MAX_METADATA_VALUE_LENGTH = 4096;

export function normalizeMediaMetadata(value: unknown = {}): Readonly<Record<string, string>> {
	if (value == null) return Object.freeze({});
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Export metadata must be an object.');
	const entries = Object.entries(value).filter(([, item]) => item != null && String(item) !== '');
	if (entries.length > MAX_METADATA_FIELDS) throw new RangeError(`Export metadata supports at most ${MAX_METADATA_FIELDS} fields.`);
	const result: Record<string, string> = {};
	for (const [rawKey, rawValue] of entries) {
		const key = String(rawKey).trim();
		if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new RangeError(`Invalid metadata field name: ${rawKey}.`);
		const text = String(rawValue);
		// eslint-disable-next-line no-control-regex
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new RangeError(`Metadata field ${key} contains control characters.`);
		if (key === 'id3Artwork') parseId3Artwork(text);
		const maximumLength = key === 'id3Artwork' ? 12 * 1024 * 1024
			: key === 'lyrics' || key === 'synchronizedLyrics' || key === 'termsOfUse' ? 65_536 : MAX_METADATA_VALUE_LENGTH;
		if (text.length > maximumLength) throw new RangeError(`Metadata field ${key} is too long.`);
		Object.defineProperty(result, key, {
			value: text, enumerable: true, writable: true, configurable: true,
		});
	}
	return Object.freeze(result);
}

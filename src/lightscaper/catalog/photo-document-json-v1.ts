/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';

export function assertPhotoDocumentByteBudgetV1(value: string): void {
	if (value.length > LIMITS.maximumDocumentBytes || new TextEncoder().encode(value).byteLength > LIMITS.maximumDocumentBytes) {
		throw new RangeError('Lightscaper document exceeds its byte budget.');
	}
}

/** Called only on normalized inert data. Object keys sort by codepoint, never locale. */
export function canonicalPhotoDocumentJsonV1(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalPhotoDocumentJsonV1).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Readonly<Record<string, unknown>>;
		return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalPhotoDocumentJsonV1(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

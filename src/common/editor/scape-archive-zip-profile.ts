/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from './scape-archive-envelope.ts';

const TEXT_ENCODER = new TextEncoder();
const ZIP_MAXIMUM_UINT16 = 0xffff;

/** Bounds zip.js' single central-directory allocation before it is constructed. */
export const SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES = 33 * 1024 * 1024;

/** Fixed central-record bytes for the pinned STORE/Zip64 export profile. */
export const SCAPE_STORE_CENTRAL_RECORD_OVERHEAD_BYTES = 46 + 65 + 8;

export interface ScapeCentralDirectoryEntry {
	readonly filename: string;
}

export function maximumScapeStoreCentralDirectoryBytes(
	entries: readonly ScapeCentralDirectoryEntry[],
): number {
	if (!Array.isArray(entries)) throw new TypeError('Scape archive entries are required.');
	if (entries.length > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The Scape archive has too many entries to estimate safely.');
	}
	let total = 0;
	for (const entry of entries) {
		if (typeof entry?.filename !== 'string' || !entry.filename) {
			throw new TypeError('A Scape archive filename is required.');
		}
		const filenameBytes = TEXT_ENCODER.encode(entry.filename).byteLength;
		if (filenameBytes > ZIP_MAXIMUM_UINT16) {
			throw new RangeError('A Scape archive filename exceeds the 65,535-byte ZIP limit.');
		}
		total += SCAPE_STORE_CENTRAL_RECORD_OVERHEAD_BYTES + filenameBytes;
		if (total > SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES) {
			throw new RangeError('The Scape central directory exceeds the portable byte limit.');
		}
	}
	return total;
}

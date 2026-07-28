/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_ARCHIVE_LIMITS } from './scape-archive-envelope.ts';
import { maximumScapeStoreCentralDirectoryBytes } from './scape-archive-zip-profile.ts';

const TEXT_ENCODER = new TextEncoder();
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const MAXIMUM_ZIP_FILENAME_BYTES = 0xffff;

/** Current non-streaming saves assemble one renderer-resident archive Blob. */
export const SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES = 512 * 1024 * 1024;

export interface ScapeArchiveSizeEntry {
	readonly filename: string;
	readonly payloadBytes: number;
}

/**
 * Conservative bound for the package-lock pinned zip.js 2.8.33 writer profile:
 * STORE, Zip64, signed descriptors, UTF-8, timestamp extras, no encryption,
 * comments, custom fields, or split segments. The eight-byte per-entry margin
 * covers the Zip64 central offset branch without duplicating writer internals.
 */
export function maximumScapeStoreArchiveBytes(
	entries: readonly ScapeArchiveSizeEntry[],
): number {
	if (!Array.isArray(entries)) throw new TypeError('Scape archive entries are required.');
	maximumScapeStoreCentralDirectoryBytes(entries);
	if (entries.length > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
		throw new RangeError('The Scape archive has too many entries to estimate safely.');
	}
	let total = 98n; // Zip64 end record, locator, and classic end record.
	for (const entry of entries) {
		if (typeof entry?.filename !== 'string' || !entry.filename) {
			throw new TypeError('A Scape archive filename is required.');
		}
		const filenameBytes = TEXT_ENCODER.encode(entry.filename).byteLength;
		if (filenameBytes > MAXIMUM_ZIP_FILENAME_BYTES) {
			throw new RangeError('A Scape archive filename exceeds the 65,535-byte ZIP limit.');
		}
		const payloadBytes = nonNegativeSafeInteger(
			entry.payloadBytes,
			`Scape archive payload ${entry.filename}`,
		);
		total += BigInt(payloadBytes) + 238n + 2n * BigInt(filenameBytes);
		if (total > MAXIMUM_SAFE_BYTES) {
			throw new RangeError('The Scape archive estimate exceeds the supported safe integer range.');
		}
	}
	return Number(total);
}

export function resolveScapeBlobMaximumBytes(value: unknown): number {
	const maximum = value == null
		? SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES
		: positiveSafeInteger(value, 'Scape final Blob maximum bytes');
	if (maximum > SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES) {
		throw new RangeError('The Scape final Blob assembly limit cannot exceed the hard limit.');
	}
	return maximum;
}

function positiveSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${field} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a safe non-negative integer.`);
	}
	return Number(value);
}

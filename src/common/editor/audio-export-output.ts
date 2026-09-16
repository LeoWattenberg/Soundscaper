/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitBrowserExportBlob,
	BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
	prepareBrowserExportBlob,
	type BrowserExportEncodedOutput,
} from './browser-export-output.ts';
import { LARGE_AUDIO_FILE_BYTES } from './large-audio-policy.ts';
import { isFileBackedAudioExport } from './file-backed-audio-export.ts';
export { registerFileBackedExport } from './file-backed-audio-export.ts';

/** Larger files keep their storage-owned body; whole-buffer output retains its memory cap. */
export function admitAudioExportBlob(
	blob: unknown,
	label = 'Audio export',
	maximumBytes?: unknown,
): Blob {
	const maximum = normalizeMaximum(maximumBytes);
	if (!(blob instanceof Blob)) throw new TypeError(`${label} output must be a Blob.`);
	if (!isFileBackedAudioExport(blob)) {
		return admitBrowserExportBlob(blob, label, Math.min(maximum, BROWSER_EXPORT_BLOB_MAXIMUM_BYTES));
	}
	if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > maximum) {
		throw new RangeError(`${label} output exceeds its ${maximum}-byte maximum.`);
	}
	return blob;
}

export function prepareAudioExportBlob(
	output: BrowserExportEncodedOutput,
	label = 'Audio export',
	maximumBytes?: unknown,
): Blob {
	if (output?.blob != null) return admitAudioExportBlob(output.blob, label, maximumBytes);
	return prepareBrowserExportBlob(output, label, Math.min(
		normalizeMaximum(maximumBytes), BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
	));
}

function normalizeMaximum(value: unknown): number {
	const maximum = value ?? LARGE_AUDIO_FILE_BYTES;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum)
		|| maximum < 1 || maximum > LARGE_AUDIO_FILE_BYTES) {
		throw new RangeError(`Audio export maximum must be a positive integer at most ${LARGE_AUDIO_FILE_BYTES} bytes.`);
	}
	return maximum;
}

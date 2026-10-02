/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitBrowserExportBlob,
	BROWSER_EXPORT_BLOB_MAXIMUM_BYTES,
	prepareBrowserExportBlob,
	browserExportEncodedByteLength,
	type BrowserExportEncodedOutput,
} from './browser-export-output.ts';
import { LARGE_AUDIO_FILE_BYTES } from './large-audio-policy.ts';
import { isFileBackedAudioExport } from './file-backed-audio-export.ts';
import { confirmFileSizeWarning, FileSizeWarningRequiredError, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';
export { registerFileBackedExport } from './file-backed-audio-export.ts';

/** Larger files keep their storage-owned body and require a confirmed admission bound. */
export function admitAudioExportBlob(
	blob: unknown,
	label = 'Audio export',
	maximumBytes?: unknown,
): Blob {
	const maximum = normalizeMaximum(maximumBytes);
	if (!(blob instanceof Blob)) throw new TypeError(`${label} output must be a Blob.`);
	if (!isFileBackedAudioExport(blob)) {
		return admitBrowserExportBlob(blob, label, maximumBytes === undefined ? BROWSER_EXPORT_BLOB_MAXIMUM_BYTES : maximum);
	}
	if (!Number.isSafeInteger(blob.size) || blob.size < 0) throw new RangeError(`${label} byte length must be a safe non-negative integer.`);
	if (blob.size > maximum) {
		throw new FileSizeWarningRequiredError({ label, byteLength: blob.size, thresholdBytes: maximum });
	}
	return blob;
}

export function prepareAudioExportBlob(
	output: BrowserExportEncodedOutput,
	label = 'Audio export',
	maximumBytes?: unknown,
): Blob {
	if (output?.blob != null) return admitAudioExportBlob(output.blob, label, maximumBytes);
	return prepareBrowserExportBlob(output, label, maximumBytes === undefined
		? BROWSER_EXPORT_BLOB_MAXIMUM_BYTES : normalizeMaximum(maximumBytes));
}

export async function prepareAudioExportBlobWithWarning(
	output: BrowserExportEncodedOutput, label = 'Audio export', maximumBytes?: unknown,
	options: FileSizeWarningOptions = {},
): Promise<Blob> {
	const byteLength = browserExportEncodedByteLength(output, label);
	const threshold = maximumBytes === undefined
		? output.blob instanceof Blob && isFileBackedAudioExport(output.blob) ? LARGE_AUDIO_FILE_BYTES : BROWSER_EXPORT_BLOB_MAXIMUM_BYTES
		: normalizeMaximum(maximumBytes);
	const admitted = await confirmFileSizeWarning(byteLength, threshold, label, options);
	return prepareAudioExportBlob(output, label, admitted);
}

export function admitAudioExportBlobWithWarning(
	blob: unknown, label = 'Audio export', maximumBytes?: unknown, options: FileSizeWarningOptions = {},
): Promise<Blob> {
	return prepareAudioExportBlobWithWarning({ blob }, label, maximumBytes, options);
}

function normalizeMaximum(value: unknown): number {
	const maximum = value ?? LARGE_AUDIO_FILE_BYTES;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum)
		|| maximum < 1) {
		throw new RangeError('Audio export maximum must be a positive safe integer.');
	}
	return maximum;
}

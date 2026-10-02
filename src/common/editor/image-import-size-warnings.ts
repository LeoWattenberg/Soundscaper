/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitImageCanonicalBody,
	admitImageImportGesture,
	IMAGE_IMPORT_LIMITS,
	type AdmittedImageImportGesture,
	type ImageImportGestureRequest,
} from './image-import-admission.ts';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';

export interface ConfirmedImageImportGesture extends AdmittedImageImportGesture {
	readonly maximumFileInputBytes: number;
}

/** Validate the complete batch, then ask about input sizes before any file is read. */
export async function confirmImageImportGesture(
	value: unknown,
	options: FileSizeWarningOptions & Readonly<{ fileNames?: readonly string[] }> = {},
): Promise<Readonly<ConfirmedImageImportGesture>> {
	const admitted = admitImageImportGesture(value, {
		maximumFileInputBytes: Number.MAX_SAFE_INTEGER,
		maximumGestureInputBytes: Number.MAX_SAFE_INTEGER,
	});
	let maximumFileInputBytes = IMAGE_IMPORT_LIMITS.maximumFileInputBytes;
	const request = value as ImageImportGestureRequest;
	for (const [index, bytes] of request.fileByteLengths.entries()) {
		const maximum = await confirmFileSizeWarning(bytes, IMAGE_IMPORT_LIMITS.maximumFileInputBytes,
			options.fileNames?.[index] ?? 'Image import', options);
		maximumFileInputBytes = Math.max(maximumFileInputBytes, maximum);
	}
	await confirmFileSizeWarning(admitted.totalInputBytes, IMAGE_IMPORT_LIMITS.maximumGestureInputBytes,
		'Image import batch', options);
	return Object.freeze({ ...admitted, maximumFileInputBytes });
}

/** Recheck the exact compressed body without imposing another fixed file ceiling. */
export async function confirmImageCanonicalBody(
	value: unknown,
	options: FileSizeWarningOptions = {},
): Promise<Readonly<{ byteLength: number }>> {
	const admitted = admitImageCanonicalBody(value, Number.MAX_SAFE_INTEGER);
	await confirmFileSizeWarning(admitted.byteLength, IMAGE_IMPORT_LIMITS.maximumCanonicalBodyBytesPerFile,
		'Canonical image body', options);
	return admitted;
}

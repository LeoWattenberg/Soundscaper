/* SPDX-License-Identifier: AGPL-3.0-only */

const VIDEO_ORIGINAL_MIME_TYPE = /^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*(?:;codecs=[a-z0-9][a-z0-9._+\-]*(?:,[a-z0-9][a-z0-9._+\-]*)*)?$/iu;

/** Validate a canonical video type or the codec-qualified type emitted by MediaRecorder. */
export function validateVideoProxyOriginalMimeType(
	value: unknown,
	name = 'video proxy original MIME type',
): string {
	if (typeof value !== 'string' || value.length > 255 || !VIDEO_ORIGINAL_MIME_TYPE.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

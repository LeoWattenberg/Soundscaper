/* SPDX-License-Identifier: AGPL-3.0-only */

export const PORTABLE_FILE_STEM_MAX_LENGTH = 64;

/** ASCII-only stem shared by portable interchange and evidence artifacts. */
export function portableFileStem(value: unknown, fallback = ''): string {
	return String(value ?? '')
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, PORTABLE_FILE_STEM_MAX_LENGTH) || fallback;
}

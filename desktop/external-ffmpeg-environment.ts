/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve only the Windows roots FFmpeg needs for system DLL discovery. */
export function curatedExternalFfmpegEnvironment(
	value: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const key of ['SystemRoot', 'WINDIR']) {
		const entry = value[key];
		if (typeof entry === 'string' && entry.length <= 32_768 && !entry.includes('\0')) {
			result[key] = entry;
		}
	}
	return Object.freeze(result);
}

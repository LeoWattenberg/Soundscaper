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

/** Bind every writable process-home and temporary root to one private directory. */
export function privateExternalFfmpegEnvironment(
	value: Readonly<Record<string, string | undefined>>,
	directory: string,
): Readonly<Record<string, string>> {
	return Object.freeze({
		AV_LOG_FORCE_NOCOLOR: '1',
		HOME: directory,
		LANG: 'C',
		LC_ALL: 'C',
		NO_COLOR: '1',
		...curatedExternalFfmpegEnvironment(value),
		TEMP: directory,
		TMP: directory,
		TMPDIR: directory,
		USERPROFILE: directory,
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

const FILE_NAME_BYTE_LIMIT = 255;
const encoder = new TextEncoder();

/** Keep generated prefixes and format suffixes while shortening only the authored stem. */
export function fitExportFileName(stem: string, prefix: string, suffix: string, reservedBytes = 0): string {
	const available = FILE_NAME_BYTE_LIMIT - encoder.encode(prefix + suffix).byteLength - reservedBytes;
	if (available <= 0) throw new RangeError('The export filename suffix exceeds the filesystem filename limit.');
	let bytes = 0;
	let retained = '';
	for (const character of stem) {
		const width = encoder.encode(character).byteLength;
		if (bytes + width > available) break;
		retained += character;
		bytes += width;
	}
	return prefix + retained + suffix;
}

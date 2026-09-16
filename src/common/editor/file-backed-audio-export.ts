/* SPDX-License-Identifier: AGPL-3.0-only */

const fileBackedExports = new WeakSet<Blob>();

/** Preserve storage provenance without loading export admission during startup. */
export function registerFileBackedExport(blob: Blob): Blob {
	if (!(blob instanceof Blob)) throw new TypeError('A file-backed export must be a Blob.');
	fileBackedExports.add(blob);
	return blob;
}

export function isFileBackedAudioExport(blob: Blob): boolean {
	return fileBackedExports.has(blob);
}

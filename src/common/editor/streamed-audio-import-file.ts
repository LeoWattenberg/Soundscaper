/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the import route's startup predicate independent of decoder code. */
export function isStreamedAudioImportFile(file: unknown): file is Blob {
	if (!(file instanceof Blob)) return false;
	const name = 'name' in file ? String(file.name) : '';
	return /\.(?:mp3|mp2|flac|ogg|oga|opus|m4a|aac|mp4|wv|wavpack)$/iu.test(name)
		|| /^(?:audio\/(?:mpeg|mp3|mp2|flac|x-flac|ogg|opus|mp4|aac|x-m4a|wavpack|x-wavpack))$/iu.test(file.type);
}

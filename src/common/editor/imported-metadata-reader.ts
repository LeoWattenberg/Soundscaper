/* SPDX-License-Identifier: AGPL-3.0-only */

/** WavPack has an APEv2 trailer; the other import formats use Mediabunny. */
export async function readImportedMetadataTags(file: Blob, signal?: AbortSignal): Promise<unknown> {
	signal?.throwIfAborted();
	if (new TextDecoder().decode(new Uint8Array(await file.slice(0, 4).arrayBuffer())) === 'wvpk') {
		return (await import('./ape-metadata-reader.ts')).readApeMetadataTags(file, signal);
	}
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({
		source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: false }),
		formats: ALL_FORMATS,
	});
	try {
		return await input.getMetadataTags();
	} finally {
		input.dispose();
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeMotionAsset, type MotionAsset } from './motion-asset.ts';
import { motionId, motionString } from './motion-values.ts';
import { probeMotionMedia } from './motion-media-probe.ts';

import { MOTION_MEDIA_IMPORT_MAXIMUM_BYTES } from './motion-media-limits.ts';
export { MOTION_MEDIA_IMPORT_MAXIMUM_BYTES } from './motion-media-limits.ts';
export interface MotionImportedMedia { readonly asset: MotionAsset; readonly body: Blob }

/** The current decoder admission is explicit before reading; exact bytes become the portable asset authority. */
export async function prepareMotionMedia(file: Blob, options: Readonly<{ id: string; name: string; signal?: AbortSignal }>): Promise<MotionImportedMedia> {
	const { signal } = options; signal?.throwIfAborted();
	if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MOTION_MEDIA_IMPORT_MAXIMUM_BYTES) throw new RangeError('Motion media import accepts files up to 64 MiB.');
	const id = motionId(options.id); const name = motionString(options.name.normalize('NFC'), 'media name', 512);
	const bytes = new Uint8Array(await file.arrayBuffer()); signal?.throwIfAborted();
	if (bytes.byteLength !== file.size) throw new Error('Media bytes changed while reading the selected file.');
	const sha = bytesToHex(sha256(bytes));
	const metadata = await probeMotionMedia(bytes, signal); signal?.throwIfAborted();
	const asset = normalizeMotionAsset({ ...metadata, id, name, byteLength: bytes.byteLength, sha256: sha, storageKey: `motion-sha256:${sha}` });
	return Object.freeze({ asset, body: new Blob([bytes], { type: asset.mimeType }) });
}

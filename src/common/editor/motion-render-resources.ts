/* SPDX-License-Identifier: AGPL-3.0-only */

import { verifyMotionAssetBody, type MotionAsset } from './motion-asset.ts';
import type { MotionAssetBody } from './motion-asset-body.ts';

export const MOTION_RENDER_ASSET_BYTES = 64 * 1024 * 1024;
export interface MotionAssetReader { readAsset(asset: MotionAsset): Promise<MotionAssetBody | null> }

/** Image/font decoding admits one bounded retained asset; footage uses its separate random-access provider. */
export async function loadMotionscaperAssetBytes(asset: MotionAsset, store: MotionAssetReader, signal?: AbortSignal): Promise<Uint8Array> {
	signal?.throwIfAborted();
	if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > MOTION_RENDER_ASSET_BYTES) throw new RangeError('This decoder admits media assets up to 64 MiB.');
	const body = await store.readAsset(asset); signal?.throwIfAborted();
	if (!body || body.size !== asset.byteLength) throw new Error(`The retained asset ${asset.name} is unavailable.`);
	const bytes = new Uint8Array(asset.byteLength); const reader = body.stream().getReader(); let offset = 0;
	const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
	signal?.addEventListener('abort', abort, { once: true });
	try {
		for (;;) {
			signal?.throwIfAborted(); const next = await reader.read(); signal?.throwIfAborted();
			if (next.done) break;
			if (!(next.value instanceof Uint8Array) || offset + next.value.byteLength > bytes.byteLength) throw new Error('A retained motion asset exceeds its declared bytes.');
			bytes.set(next.value, offset); offset += next.value.byteLength;
		}
		if (offset !== bytes.byteLength) throw new Error('A retained motion asset is truncated.');
		verifyMotionAssetBody(asset, bytes); return bytes;
	} finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

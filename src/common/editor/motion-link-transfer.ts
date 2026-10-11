/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionAssetBody } from './motion-asset-body.ts';
import type { MotionscaperRevision } from './motion-project-revision.ts';
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from './motion-link-protocol.ts';
import { motionInteger } from './motion-values.ts';

export const MOTION_LINK_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export interface MotionLinkTransferTransaction {
	/** Receiver stages sequential writes privately; it must detach any bytes retained after this promise resolves. */
	write(asset: MotionAsset, bytes: Uint8Array): Promise<void>;
	/** Verify the retained body against this digest/length independently before making it committable. */
	finish(asset: MotionAsset): Promise<void>;
	/** Atomically retain every aliased descriptor and complete verified closure, then publish; failure preserves the previous revision. */
	commit(offer: MotionCompositionOffer): Promise<void>;
	rollback(): Promise<void>;
}

/** Transport-independent, bounded digest verification. A receiver may publish only after the complete immutable closure arrives. */
export async function transferMotionCompositionOffer(value: unknown, options: Readonly<{
	begin: (offer: MotionCompositionOffer) => Promise<MotionLinkTransferTransaction>;
	readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>;
	signal?: AbortSignal; maximumBytes?: number;
}>): Promise<MotionscaperRevision> {
	options.signal?.throwIfAborted(); const offer = normalizeMotionCompositionOffer(value);
	const maximum = motionInteger(options.maximumBytes ?? 8 * 1024 ** 3, 'linked asset byte budget', 1, 64 * 1024 ** 3);
	const assets = new Map<string, MotionAsset>(); let total = 0;
	for (const asset of offer.revision.project.assets) {
		const prior = assets.get(asset.sha256);
		if (prior && prior.byteLength !== asset.byteLength) throw new RangeError('Motion linked asset aliases disagree about their byte length.');
		if (prior) continue;
		assets.set(asset.sha256, asset); total += asset.byteLength;
		if (!Number.isSafeInteger(total) || total > maximum) throw new RangeError('Motion linked asset closure exceeds its byte budget.');
	}
	options.signal?.throwIfAborted(); const transaction = await options.begin(offer);
	try {
		for (const asset of assets.values()) {
			options.signal?.throwIfAborted(); const body = await options.readAsset(asset, options.signal); options.signal?.throwIfAborted();
			if (!body || body.size !== asset.byteLength) throw new RangeError(`Motion linked asset ${asset.id} is unavailable or has a different size.`);
			const reader = body.stream().getReader(); const digest = sha256.create(); let size = 0; let completed = false;
			const cancel = () => { void reader.cancel(options.signal?.reason).catch(() => undefined); };
			options.signal?.addEventListener('abort', cancel, { once: true });
			try {
				while (true) {
					options.signal?.throwIfAborted(); const result = await reader.read(); options.signal?.throwIfAborted();
					if (result.done) { completed = true; break; }
					const chunk = result.value;
					if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > MOTION_LINK_MAXIMUM_CHUNK_BYTES || chunk.length > asset.byteLength - size) throw new RangeError(`Motion linked asset ${asset.id} stream exceeds its chunk/length contract.`);
					// Own the bounded chunk while hashing and staging; the provider cannot change it during an awaited write.
					const retained = chunk.slice(); digest.update(retained); size += retained.length; await transaction.write(asset, retained);
				}
			} finally {
				options.signal?.removeEventListener('abort', cancel);
				try { if (!completed) await reader.cancel(); } finally { reader.releaseLock(); }
			}
			if (size !== asset.byteLength || bytesToHex(digest.digest()) !== asset.sha256) throw new RangeError(`Motion linked asset ${asset.id} digest or byte length differs from its contract.`);
			options.signal?.throwIfAborted(); await transaction.finish(asset);
		}
		options.signal?.throwIfAborted(); await transaction.commit(offer); return offer.revision;
	} catch (error) {
		try { await transaction.rollback(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Motion link transfer and rollback failed.', { cause: cleanup }); }
		throw error;
	}
}

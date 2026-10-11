/* SPDX-License-Identifier: AGPL-3.0-only */
import { createScapeArchiveByteSource } from './scape-archive-byte-source.ts';
import { createMotionCompositionOffer, type MotionCompositionOffer } from './motion-link-protocol.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionAssetBody } from './motion-asset-body.ts';
import { MOTION_SAVED_FILE_CHUNK_BYTES, normalizeMotionSavedFileSnapshot, type MotionSavedFileCapabilities } from './motion-saved-file-contract.ts';
import { withMotionSavedArchiveSource } from './motion-saved-archive-source.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';
export interface MotionSavedFileReceiverOptions {
	readonly compositionId?: string; readonly signal?: AbortSignal;
	/** Receiver retains the complete digest-verified closure through its owner CAS before resolving. */
	receive(offer: MotionCompositionOffer, options: Readonly<{ readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>; signal?: AbortSignal }>): Promise<void>;
}
export interface MotionSavedFileReceipt { readonly projectId: string; readonly compositionId: string; readonly digest: string; readonly generation: number }

export class MotionSavedFilePostPublicationError extends Error {
	readonly receipt: MotionSavedFileReceipt;
	constructor(receipt: MotionSavedFileReceipt, cause: unknown) { super('The Motion revision was received, but saved-file cleanup did not complete.', { cause }); this.name = 'MotionSavedFilePostPublicationError'; this.receipt = receipt; }
}

/** No file path or live reader becomes authored intent. The pinned capability closes after receiver publication or failure. */
export async function receiveMotionSavedFileSnapshot(files: MotionSavedFileCapabilities, value: unknown, options: MotionSavedFileReceiverOptions): Promise<MotionSavedFileReceipt> {
	const snapshot = normalizeMotionSavedFileSnapshot(value); let failed = false, primary: unknown, receipt: MotionSavedFileReceipt | undefined, published: MotionSavedFileReceipt | undefined;
	try {
		throwIfScapeAborted(options.signal);
		const input = createScapeArchiveByteSource({ size: snapshot.byteLength, maximumReadBytes: MOTION_SAVED_FILE_CHUNK_BYTES,
			read: async ({ offset, length, signal }) => { throwIfScapeAborted(options.signal); throwIfScapeAborted(signal);
				const bytes = await files.read({ token: snapshot.token, offset, length }); throwIfScapeAborted(options.signal); throwIfScapeAborted(signal); return bytes;
			},
		});
		receipt = await withMotionSavedArchiveSource(input, async source => {
			const offer = createMotionCompositionOffer(options.compositionId ?? source.revision.project.primaryCompositionId, source.revision);
			await options.receive(offer, { readAsset: source.readAsset, signal: options.signal });
			// The receiver commit is authoritative; a later abort cannot turn a completed publication into cancellation.
			published = Object.freeze({ projectId: offer.revision.projectId, compositionId: offer.compositionId, digest: offer.revision.digest, generation: snapshot.generation }); return published;
		}, options.signal);
	} catch (error) {
		if (published && options.signal?.aborted && error instanceof DOMException && error.name === 'AbortError') receipt = published;
		else { failed = true; primary = error; }
	}
	try { await files.release({ token: snapshot.token }); } catch (cleanup) {
		const failure = failed ? aggregateScapeErrors(primary, [cleanup], 'Motion saved-file receive and capability release failed.') : cleanup;
		if (published) throw new MotionSavedFilePostPublicationError(published, failure); throw failure;
	}
	if (failed) { if (published) throw new MotionSavedFilePostPublicationError(published, primary); throw primary; } return receipt!;
}

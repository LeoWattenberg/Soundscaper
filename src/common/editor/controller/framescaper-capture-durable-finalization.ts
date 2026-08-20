/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureSessionManifestV1 } from '../framescaper-capture-session-manifest.ts';

interface FramescaperCaptureDurableFinalizationOptions {
	readonly state: FramescaperCaptureSessionManifestV1['state'];
	readonly publish: () => Promise<Readonly<{
		readonly manifest: Pick<FramescaperCaptureSessionManifestV1, 'state'>;
	}>>;
	readonly retireCommitted: () => Promise<void>;
	readonly refreshRecovery: () => Promise<void>;
	readonly onCleanupWarning?: (error: unknown) => void;
}

/** Separate canonical success from retryable cleanup of its terminal durable tombstone. */
export async function finalizeFramescaperCaptureDurability(
	options: FramescaperCaptureDurableFinalizationOptions,
): Promise<void> {
	if (options.state === 'committed') {
		await retireWithoutRegressingCommit(options);
		return;
	}
	let committed = false;
	try {
		const result = await options.publish();
		if (result.manifest.state !== 'committed') {
			throw new Error('Canonical Framescaper capture publication did not settle durably.');
		}
		committed = true;
		await retireWithoutRegressingCommit(options);
	} finally {
		if (!committed) await options.refreshRecovery();
	}
}

async function retireWithoutRegressingCommit(options: FramescaperCaptureDurableFinalizationOptions): Promise<void> {
	try { await options.retireCommitted(); }
	catch (error) {
		try { options.onCleanupWarning?.(error); }
		catch { /* Warning sinks cannot regress a committed capture. */ }
	}
}

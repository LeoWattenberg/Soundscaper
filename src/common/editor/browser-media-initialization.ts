/* SPDX-License-Identifier: AGPL-3.0-only */

const initializedDocuments = new WeakSet<Document>();

/**
 * Initialize the owning document's native media backend before WebCodecs probes.
 * Some GStreamer WebKit builds register encoder types before initializing their
 * type system. The normal media capability path initializes it first (WebKit
 * bug 320327). This query is initialization only: its answer never substitutes
 * for the exact native encoder probe. The element stays detached and has no URL.
 *
 * A worker has no document. Its document owner must perform preflight before
 * native media work is delegated; this helper never marks such a realm ready.
 */
export function initializeBrowserMediaPlatform(
	owner: Document | undefined = typeof document === 'undefined' ? undefined : document,
): void {
	if (!owner || initializedDocuments.has(owner)) return;
	const media = owner.createElement('video');
	try { media.canPlayType('video/mp4'); }
	finally { media.remove(); }
	initializedDocuments.add(owner);
}

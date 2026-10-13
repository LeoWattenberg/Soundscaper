/* SPDX-License-Identifier: AGPL-3.0-only */
import { isUsedApplicationAsset, replayUsedApplicationAssets, type ResourceWorkerContainer, type UsedResourceReplayOptions } from './application-shell-used-assets.ts';
import { observeApplicationResources } from './application-shell-resource-observation.ts';

/** Preserve the bounded font-only API for callers that explicitly request it. */
export function replayUsedApplicationFonts(options: UsedResourceReplayOptions): Promise<readonly string[]> {
	return replayUsedApplicationAssets(options, 'fonts');
}

/** Optional browser handoff; minimal registration fakes and unsupported hosts are unchanged. */
export async function replayDocumentApplicationFonts(
	serviceWorker: unknown, registration: unknown, scriptUrl: string,
): Promise<void> {
	if (!globalThis.document || !globalThis.performance || !globalThis.location
		|| !serviceWorker || typeof serviceWorker !== 'object' || !('controller' in serviceWorker)
		|| !('addEventListener' in serviceWorker) || typeof serviceWorker.addEventListener !== 'function'
		|| !('removeEventListener' in serviceWorker) || typeof serviceWorker.removeEventListener !== 'function'
		|| !registration || typeof registration !== 'object' || !('active' in registration)) return;
	const container = serviceWorker as ResourceWorkerContainer;
	const owner = registration as Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'waiting'>;
	const root = document.documentElement;
	const abort = new AbortController();
	const stop = () => abort.abort();
	globalThis.addEventListener('pagehide', stop, { once: true });
	root.dataset.offlineUsedFonts = 'pending';
	root.dataset.offlineUsedAssets = 'pending';
	root.dataset.offlineUsedAssetScope = 'observed-completed-resources';
	delete root.dataset.offlineUsedAssetUrls;
	let observation: ReturnType<typeof observeApplicationResources> | undefined;
	delete root.dataset.offlineUsedFontUrls;
	try {
		const supported = typeof globalThis.PerformanceObserver === 'function' && typeof performance.addEventListener === 'function';
		if (supported) observation = observeApplicationResources(performance, PerformanceObserver);
		const urls = await replayUsedApplicationAssets({
			serviceWorker: container, activeWorker: () => owner.active,
			updatePending: () => Boolean(owner.installing || owner.waiting),
			origin: location.origin, scriptUrl, signal: abort.signal,
			fontsReady: document.fonts?.ready,
			resourceNames: () => observation?.read() ?? performance.getEntriesByType('resource').map((entry) => entry.name),
			fetch: (url, options) => globalThis.fetch(url, options),
		}, supported ? 'assets' : 'fonts');
		root.dataset.offlineUsedFontUrls = JSON.stringify(urls.filter(url => isUsedApplicationAsset(url, location.origin, 'fonts')));
		if (supported) {
			root.dataset.offlineUsedAssetUrls = JSON.stringify(urls);
			root.dataset.offlineUsedAssets = 'settled';
		} else root.dataset.offlineUsedAssets = 'unsupported';
		// Completion means settled replay, not guaranteed persistence under storage pressure.
		root.dataset.offlineUsedFonts = 'complete';
	} catch {
		root.dataset.offlineUsedFonts = 'failed';
		root.dataset.offlineUsedAssets = 'failed';
	} finally {
		observation?.dispose();
		globalThis.removeEventListener('pagehide', stop);
	}
}

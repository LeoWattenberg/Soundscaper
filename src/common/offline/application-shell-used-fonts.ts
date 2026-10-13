/* SPDX-License-Identifier: AGPL-3.0-only */

interface FontWorkerContainer extends Pick<EventTarget, 'addEventListener' | 'removeEventListener'> {
	readonly controller: { readonly scriptURL: string } | null;
}

interface UsedFontReplayOptions {
	readonly serviceWorker: FontWorkerContainer;
	readonly activeWorker: () => FontWorkerContainer['controller'];
	readonly updatePending: () => boolean;
	readonly origin: string;
	readonly scriptUrl: string;
	readonly resourceNames: () => readonly string[];
	readonly fontsReady?: Promise<unknown>;
	readonly fetch: (url: string, options: RequestInit) => Promise<Response>;
	readonly signal?: AbortSignal;
	readonly deadlineMs?: number;
}

/** Replays only fonts that this document already loaded before acquiring its worker. */
export async function replayUsedApplicationFonts(options: UsedFontReplayOptions): Promise<readonly string[]> {
	const script = new URL(options.scriptUrl, options.origin).href;
	const abort = new AbortController();
	const deadlineMs = options.deadlineMs ?? 30_000;
	if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 30_000) {
		throw new Error('Invalid used-font replay deadline.');
	}
	const cancel = () => abort.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', cancel, { once: true });
	if (options.signal?.aborted) cancel();
	const timer = setTimeout(() => abort.abort(new Error('Used-font replay timed out.')), deadlineMs);
	const owned = () => options.serviceWorker.controller !== null
		&& options.serviceWorker.controller === options.activeWorker()
		&& options.serviceWorker.controller.scriptURL === script
		&& !options.updatePending();
	let rejectAbort!: (reason: unknown) => void;
	const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
	const interrupted = () => rejectAbort(abort.signal.reason);
	abort.signal.addEventListener('abort', interrupted, { once: true });
	let unlisten: (() => void) | undefined;
	try {
		abort.signal.throwIfAborted();
		await Promise.race([options.fontsReady ?? Promise.resolve(), cancelled]);
		const urls = [...new Set(options.resourceNames().filter((name) => {
			try {
				const url = new URL(name);
				return url.origin === options.origin && !url.search && !url.hash
					&& /^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:woff2?|ttf|otf)$/u.test(url.pathname);
			} catch { return false; }
		}))];
		if (urls.length > 32) throw new Error('Used-font replay limit exceeded.');
		if (urls.length === 0) return Object.freeze([]);
		if (!owned()) {
			await Promise.race([new Promise<void>((resolve) => {
				const changed = () => { if (owned()) resolve(); };
				options.serviceWorker.addEventListener('controllerchange', changed);
				unlisten = () => options.serviceWorker.removeEventListener('controllerchange', changed);
				changed();
			}), cancelled]);
		}
		for (const url of urls) {
			abort.signal.throwIfAborted();
			if (!owned()) throw new Error('Used-font replay controller changed.');
			// The own worker verifies the build descriptor/body and awaits its cache write.
			const response = await Promise.race([options.fetch(url, {
				cache: 'default', credentials: 'same-origin', redirect: 'error', signal: abort.signal,
			}), cancelled]);
			await Promise.race([response.body?.cancel() ?? Promise.resolve(), cancelled]);
			if (response.status !== 200) throw new Error('Used-font replay request failed.');
			if (!owned()) throw new Error('Used-font replay controller changed.');
		}
		return Object.freeze(urls);
	} finally {
		clearTimeout(timer);
		unlisten?.();
		options.signal?.removeEventListener('abort', cancel);
		abort.signal.removeEventListener('abort', interrupted);
		abort.abort();
	}
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
	const container = serviceWorker as FontWorkerContainer;
	const owner = registration as Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'waiting'>;
	const root = document.documentElement;
	const abort = new AbortController();
	const stop = () => abort.abort();
	globalThis.addEventListener('pagehide', stop, { once: true });
	root.dataset.offlineUsedFonts = 'pending';
	delete root.dataset.offlineUsedFontUrls;
	try {
		const urls = await replayUsedApplicationFonts({
			serviceWorker: container, activeWorker: () => owner.active,
			updatePending: () => Boolean(owner.installing || owner.waiting),
			origin: location.origin, scriptUrl, signal: abort.signal,
			fontsReady: document.fonts?.ready,
			resourceNames: () => performance.getEntriesByType('resource').map((entry) => entry.name),
			fetch: (url, options) => globalThis.fetch(url, options),
		});
		root.dataset.offlineUsedFontUrls = JSON.stringify(urls);
		// Completion means settled replay, not guaranteed persistence under storage pressure.
		root.dataset.offlineUsedFonts = 'complete';
	} catch {
		root.dataset.offlineUsedFonts = 'failed';
	} finally {
		globalThis.removeEventListener('pagehide', stop);
	}
}

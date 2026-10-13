/* SPDX-License-Identifier: AGPL-3.0-only */

export function isUsedApplicationAsset(name: string, origin: string, kind: 'fonts' | 'assets' = 'assets'): boolean {
	try {
		const url = new URL(name);
		return url.origin === origin && !url.search && !url.hash && name === url.href
			&& (kind === 'fonts' ? /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:woff2?|ttf|otf)$/u
				: /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|woff2?|ttf|otf)$/u).test(url.pathname);
	} catch { return false; }
}

export interface ResourceWorkerContainer extends Pick<EventTarget, 'addEventListener' | 'removeEventListener'> {
	readonly controller: { readonly scriptURL: string } | null;
}

export interface UsedResourceReplayOptions {
	readonly serviceWorker: ResourceWorkerContainer;
	readonly activeWorker: () => ResourceWorkerContainer['controller'];
	readonly updatePending: () => boolean;
	readonly origin: string;
	readonly scriptUrl: string;
	readonly resourceNames: () => readonly string[];
	readonly fontsReady?: Promise<unknown>;
	readonly fetch: (url: string, options: RequestInit) => Promise<Response>;
	readonly signal?: AbortSignal;
	readonly deadlineMs?: number;
}

/** Replays only the observed completed set; settlement is not persistent cache custody. */
export async function replayUsedApplicationAssets(options: UsedResourceReplayOptions, kind: 'fonts' | 'assets' = 'assets'): Promise<readonly string[]> {
	const script = new URL(options.scriptUrl, options.origin).href;
	if (new URL(options.origin).origin !== options.origin || new URL(script).origin !== options.origin) throw new Error('Invalid replay origin.');
	const label = kind === 'fonts' ? 'Used-font' : 'Used-asset';
	const abort = new AbortController();
	const deadlineMs = options.deadlineMs ?? 30_000;
	if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 30_000) {
		throw new Error(`Invalid ${label} replay deadline.`);
	}
	const cancel = () => abort.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', cancel, { once: true });
	if (options.signal?.aborted) cancel();
	const timer = setTimeout(() => abort.abort(new Error(`${label} replay timed out.`)), deadlineMs);
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
		const urls: string[] = [];
		const collect = () => {
			const names = options.resourceNames();
			if (names.length > 4096) throw new Error(`${label} replay observation limit exceeded.`);
			for (const name of names) {
				if (isUsedApplicationAsset(name, options.origin, kind) && !urls.includes(name)) urls.push(name);
			}
			if (urls.length > (kind === 'fonts' ? 32 : 256)
				|| urls.filter(url => isUsedApplicationAsset(url, options.origin, 'fonts')).length > 32) {
				throw new Error(`${label} replay limit exceeded.`);
			}
		};
		collect();
		if (kind === 'fonts' && urls.length === 0) return Object.freeze([]);
		if (!owned()) {
			await Promise.race([new Promise<void>((resolve) => {
				const changed = () => { if (owned()) resolve(); };
				options.serviceWorker.addEventListener('controllerchange', changed);
				unlisten = () => options.serviceWorker.removeEventListener('controllerchange', changed);
				changed();
			}), cancelled]);
		}
		collect(); // Includes pre-control work that completed while the exact owner was acquired.
		for (let index = 0; index < urls.length; index += 1) {
			const url = urls[index]!;
			abort.signal.throwIfAborted();
			if (!owned()) throw new Error(`${label} replay controller changed.`);
			// The own worker verifies the build descriptor/body and awaits its cache write.
			const response = await Promise.race([options.fetch(url, {
				cache: 'default', credentials: 'same-origin', redirect: 'error', signal: abort.signal,
			}), cancelled]);
			await Promise.race([response.body?.cancel() ?? Promise.resolve(), cancelled]);
			if (response.status !== 200) throw new Error(`${label} replay request failed.`);
			if (!owned()) throw new Error(`${label} replay controller changed.`);
			collect(); // Replays new completed observations, never unobserved manifest inventory.
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


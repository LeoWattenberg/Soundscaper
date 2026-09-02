/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Recognising, confirming and discarding a build that moved on under a live tab.
 *
 * Every product feature that is not part of the startup graph arrives as a
 * content-hashed chunk fetched on first use, and navigation documents are served
 * with a long `max-age`. A tab opened before a deploy therefore keeps running an
 * HTML document that names chunk filenames the origin no longer serves, and the
 * first menu action that reaches for one of them fails - historically by tearing
 * the editor down through the top-level error boundary, long after the user
 * could have been told what actually happened.
 *
 * The failure itself is not evidence of staleness: a dropped connection produces
 * the same rejection. So the two halves are kept apart here. `isModuleLoadFailure`
 * recognises the shape of the rejection, and `probeStaleBuild` establishes
 * whether the deploy has genuinely moved by asking the origin for the inventory
 * the offline shell already publishes at `/offline-shell.json` - a `no-store`
 * document listing every asset URL of the current release. A tab whose own chunk
 * is missing from that inventory is provably running a retired build; a tab that
 * cannot reach the inventory at all learns nothing, and says so.
 */

/** A response, narrowed to what the inventory probe reads from it. */
export interface ShellInventoryResponse {
	readonly ok: boolean;
	json(): Promise<unknown>;
}

export type ShellInventoryFetch = (
	url: string,
	init: Readonly<{ cache: 'no-store'; credentials: 'omit' }>,
) => Promise<ShellInventoryResponse>;

export interface ShellCacheStorage {
	keys(): Promise<readonly string[]>;
	delete(cacheName: string): Promise<boolean>;
}

export interface ShellServiceWorkerRegistration {
	unregister(): Promise<boolean>;
}

export interface ShellServiceWorkerContainer {
	getRegistrations(): Promise<readonly ShellServiceWorkerRegistration[]>;
}

/**
 * `stale` is a proof, not a guess: the origin's live inventory no longer lists
 * the asset this tab is running from. `unknown` covers every case where the
 * question could not be answered - a dev server, a desktop shell, an offline
 * device - and callers must treat it as "carry on", never as "reload".
 */
export type StaleBuildVerdict = 'stale' | 'current' | 'unknown';

export interface StaleBuildProbeOptions {
	/** `import.meta.url` of an eagerly loaded module, so it names this tab's own built chunk. */
	readonly moduleUrl: string;
	readonly fetchImpl?: ShellInventoryFetch;
	readonly inventoryPath?: string;
}

export interface DiscardStaleBuildOptions {
	readonly cacheStorage?: ShellCacheStorage;
	readonly serviceWorker?: ShellServiceWorkerContainer;
	readonly documentUrl?: string;
	readonly fetchImpl?: ShellInventoryFetch;
	readonly reload: () => void;
}

/**
 * The cache-name prefix the generated worker builds its names from.
 *
 * `shellCacheName` in `scripts/lib/offline-shell-worker.mjs` is the authority;
 * it is repeated as a literal because that function is serialised into the
 * worker and shares no module with the page. The prefix stops short of the
 * schema version so that a v1 cache left by an older release is discarded too.
 */
export const SHELL_CACHE_NAME_PREFIX = 'soundscaper-application-shell';

/** Where the build publishes the asset inventory of the release it is serving. */
export const SHELL_INVENTORY_PATH = '/offline-shell.json';

/**
 * Browser phrasings for "a dynamic import did not arrive".
 *
 * Each engine words this differently and none of them expose a stable error
 * code, so the message is all there is to match on. The patterns stay narrow:
 * a bare `Failed to fetch` is deliberately absent, because it is also every
 * ordinary `fetch` rejection in the application and would turn unrelated
 * network noise into a reload prompt.
 */
const MODULE_LOAD_FAILURE_PATTERNS: readonly RegExp[] = Object.freeze([
	// Chromium
	/failed to fetch dynamically imported module/iu,
	// Firefox
	/error loading dynamically imported module/iu,
	// WebKit
	/importing a module script failed/iu,
	/module source url is not a valid url/iu,
	// A 404 answered with an HTML body, in any engine
	/failed to load module script/iu,
	/expected a javascript(?:-or-wasm)? module script/iu,
	// Vite's preload helper, for a stylesheet that belongs to a missing chunk
	/unable to preload css/iu,
]);

/** Whether a rejection is a chunk that never arrived, rather than a fault inside one. */
export function isModuleLoadFailure(error: unknown): boolean {
	const message = error instanceof Error ? error.message
		: typeof error === 'string' ? error
		: '';
	if (!message) return false;
	return MODULE_LOAD_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Whether the origin still serves the release this tab is running.
 *
 * The probe is deliberately one request against a document the build already
 * emits and Cloudflare already serves `no-store`, so it costs nothing to keep
 * accurate and cannot itself be answered from a stale cache.
 */
export async function probeStaleBuild(options: StaleBuildProbeOptions): Promise<StaleBuildVerdict> {
	const moduleUrl = parseUrl(options.moduleUrl);
	if (!moduleUrl || !['http:', 'https:'].includes(moduleUrl.protocol)) return 'unknown';
	const fetchImpl = options.fetchImpl ?? (globalThis.fetch as ShellInventoryFetch | undefined);
	if (typeof fetchImpl !== 'function') return 'unknown';
	const inventoryUrl = parseUrl(options.inventoryPath ?? SHELL_INVENTORY_PATH, moduleUrl.href);
	if (!inventoryUrl || inventoryUrl.origin !== moduleUrl.origin) return 'unknown';
	let audit: unknown;
	try {
		const response = await fetchImpl(inventoryUrl.href, { cache: 'no-store', credentials: 'omit' });
		if (!response?.ok) return 'unknown';
		audit = await response.json();
	} catch {
		return 'unknown';
	}
	const served = inventoryAssetPaths(audit);
	if (!served) return 'unknown';
	return served.has(moduleUrl.pathname) ? 'current' : 'stale';
}

/**
 * Clears everything that would otherwise hand the reload the old build back.
 *
 * Three layers hold the retired release and all of them have to go. The shell
 * caches answer asset requests before the network. The registered worker is the
 * subtler one: its replacement installs but waits, because the generated worker
 * never calls `skipWaiting` and a reload does not release the client, so a tab
 * that merely reloads is served the same cached document by the same old worker
 * indefinitely. And the document itself sits in the HTTP cache under a long
 * `max-age`, which a revalidating fetch displaces before the reload asks for it.
 *
 * Each step is independently guarded. A browser that refuses one of them still
 * gets the reload, which is the step that can actually recover the tab.
 */
export async function discardStaleBuild(options: DiscardStaleBuildOptions): Promise<void> {
	const cacheStorage = options.cacheStorage ?? (globalThis.caches as ShellCacheStorage | undefined);
	if (cacheStorage) {
		try {
			const names = await cacheStorage.keys();
			await Promise.all(names
				.filter((name) => name.startsWith(SHELL_CACHE_NAME_PREFIX))
				.map((name) => cacheStorage.delete(name).catch(() => false)));
		} catch {
			// A storage policy that hides the cache cannot be serving one either.
		}
	}
	const serviceWorker = options.serviceWorker
		?? (globalThis.navigator?.serviceWorker as ShellServiceWorkerContainer | undefined);
	if (serviceWorker && typeof serviceWorker.getRegistrations === 'function') {
		try {
			const registrations = await serviceWorker.getRegistrations();
			await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
		} catch {
			// Same reasoning: an unreadable registration cannot be intercepting this tab.
		}
	}
	const documentUrl = options.documentUrl ?? globalThis.location?.href;
	const fetchImpl = options.fetchImpl ?? (globalThis.fetch as ShellInventoryFetch | undefined);
	if (documentUrl && typeof fetchImpl === 'function') {
		try {
			await fetchImpl(documentUrl, { cache: 'no-store', credentials: 'omit' });
		} catch {
			// The reload revalidates on its own in most engines; this only makes it certain.
		}
	}
	options.reload();
}

/** The set of asset paths a published `/offline-shell.json` says the origin is serving. */
function inventoryAssetPaths(audit: unknown): ReadonlySet<string> | null {
	if (typeof audit !== 'object' || audit === null) return null;
	const assets = (audit as { assets?: unknown }).assets;
	if (!Array.isArray(assets) || assets.length === 0) return null;
	const paths = new Set<string>();
	for (const asset of assets) {
		const url = typeof asset === 'object' && asset !== null ? (asset as { url?: unknown }).url : undefined;
		if (typeof url === 'string' && url.startsWith('/')) paths.add(url);
	}
	return paths.size > 0 ? paths : null;
}

function parseUrl(value: string, base?: string): URL | null {
	try {
		return base === undefined ? new URL(value) : new URL(value, base);
	} catch {
		return null;
	}
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProductId, productIdentity } from '../product-identities.js';
import { BUILT_PRODUCT_ID } from '../site/route.js';

interface OfflineServiceWorkerContainer {
	register(
		scriptURL: string,
		options: Readonly<{
			scope: string;
			type: 'classic';
			updateViaCache: 'none';
		}>,
	): Promise<unknown>;
}

export interface RegisterOfflineApplicationShellOptions {
	readonly desktop: boolean;
	readonly productId: 'framescaper' | 'soundscaper';
	readonly builtProductId?: 'framescaper' | 'soundscaper';
	readonly location?: Pick<URL, 'protocol'>;
	readonly serviceWorker?: OfflineServiceWorkerContainer;
}

export interface OfflineApplicationShellTarget {
	readonly scriptUrl: string;
	readonly scope: string;
}

export interface ScheduleOfflineApplicationShellOptions extends RegisterOfflineApplicationShellOptions {
	readonly waitForLoad?: () => Promise<void>;
	readonly waitForEditor?: () => Promise<void>;
	readonly waitForIdle?: () => Promise<void>;
}

export type OfflineApplicationShellRegistrationResult =
	| Readonly<{ status: 'registered'; registration: unknown }>
	| Readonly<{ status: 'unsupported' }>
	| Readonly<{ status: 'failed'; error: unknown }>;

/**
 * Which worker this build emits for one product, and the scope it may claim.
 *
 * A worker script bounds the maximum scope it can control, so where the script
 * lives is decided by the build, not by the product alone: this is the runtime
 * mirror of `webBuildRouting` in `scripts/lib/product-web-routing.mjs`, and the
 * registration side of `productHref`. Only the Soundscaper build serves two
 * products from one origin — soundscaper.org keeps Framescaper under
 * `/framescaper/` for the whole cutover — so only there does a product base
 * path survive. Every other build serves one product from its origin root and
 * emits exactly `/service-worker.js` at scope `/`.
 *
 * It fails closed rather than guessing: a build that emits no worker for the
 * requested product registers nothing, because a wrongly scoped registration
 * either 404s or claims a scope whose documents it cannot serve offline.
 */
export function resolveOfflineApplicationShellTarget(
	productId: string,
	builtProductId: string = BUILT_PRODUCT_ID,
): OfflineApplicationShellTarget {
	const built = normalizeProductId(builtProductId);
	const target = normalizeProductId(productId);
	if (built !== 'soundscaper' && target !== built) {
		throw new Error(`The ${built} build serves no ${target} document, so it registers no ${target} worker.`);
	}
	const basePath = built === 'soundscaper' ? String(productIdentity(target).basePath) : '';
	return Object.freeze({ scriptUrl: `${basePath}/service-worker.js`, scope: `${basePath}/` });
}

/** Registers the generated web-only worker without making app startup depend on it. */
export async function registerOfflineApplicationShell(
	options: RegisterOfflineApplicationShellOptions,
): Promise<OfflineApplicationShellRegistrationResult> {
	const location = options.location ?? globalThis.location;
	const serviceWorker = options.serviceWorker
		?? (globalThis.navigator?.serviceWorker as OfflineServiceWorkerContainer | undefined);
	if (options.desktop || !location || !['http:', 'https:'].includes(location.protocol)
		|| !serviceWorker || typeof serviceWorker.register !== 'function') {
		return Object.freeze({ status: 'unsupported' });
	}
	try {
		const { scriptUrl, scope } = resolveOfflineApplicationShellTarget(options.productId, options.builtProductId);
		const registration = await serviceWorker.register(scriptUrl, {
			scope,
			type: 'classic',
			updateViaCache: 'none',
		});
		return Object.freeze({ status: 'registered', registration });
	} catch (error) {
		return Object.freeze({ status: 'failed', error });
	}
}

/** Defers the non-critical shell download until the initial editor is usable and the browser is idle. */
export async function scheduleOfflineApplicationShellRegistration(
	options: ScheduleOfflineApplicationShellOptions,
): Promise<OfflineApplicationShellRegistrationResult> {
	await (options.waitForLoad ?? waitForDocumentLoad)();
	await (options.waitForEditor ?? waitForEditorReadiness)();
	await (options.waitForIdle ?? waitForBrowserIdle)();
	return registerOfflineApplicationShell(options);
}

function waitForDocumentLoad(): Promise<void> {
	if (globalThis.document?.readyState === 'complete') return Promise.resolve();
	return new Promise((resolve) => globalThis.addEventListener('load', () => resolve(), { once: true }));
}

function waitForEditorReadiness(): Promise<void> {
	const root = globalThis.document?.getElementById('app');
	if (!root || root.querySelector('[data-audio-editor-bound="true"], [role="alert"]')) return Promise.resolve();
	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			if (!root.querySelector('[data-audio-editor-bound="true"], [role="alert"]')) return;
			observer.disconnect();
			resolve();
		});
		observer.observe(root, { childList: true, subtree: true });
	});
}

function waitForBrowserIdle(): Promise<void> {
	const requestIdleCallback = (globalThis as typeof globalThis & {
		requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
	}).requestIdleCallback;
	return new Promise((resolve) => {
		if (requestIdleCallback) requestIdleCallback(() => resolve(), { timeout: 5_000 });
		else globalThis.setTimeout(resolve, 1_000);
	});
}
